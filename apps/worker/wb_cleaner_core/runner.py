"""Orchestrator: подменяет I/O в старом WBClusterOptimizer на БД-вызовы,
сохраняя анализ-логику нетронутой. Точка входа для CLI (см. cli.py).

В preview-режиме (account.mode == 'preview') воркер всё анализирует и пишет
decisions, но НЕ вызывает set-minus в WB. Это критичный инвариант:
любой случайно подключённый аккаунт получает 7-дневную защиту.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import psycopg

from . import db
from .db_minus_cache import DBMinusCache
from .reason_codes import rule_to_code

# Старое ядро импортируется как есть. Файл лежит рядом, в той же папке.
from .wb_cluster_optimizer import (
    Config,
    WBAdvertAPI,
    ClusterAnalyzer,
    WBClusterOptimizer,
)


log = logging.getLogger(__name__)


@dataclass
class AccountRunSummary:
    account_id: str
    run_id: str
    status: str  # succeeded|failed|partial
    campaigns_total: int = 0
    campaigns_processed: int = 0
    clusters_analyzed: int = 0
    decisions_exclude: int = 0
    decisions_keep: int = 0
    applied: int = 0
    skipped_preview: bool = False
    error: Optional[str] = None
    processing_time_sec: float = 0.0


def _config_from_rules(rules: db.RulesProfile) -> Config:
    """RulesProfile из БД → Config старого ядра. Один-в-один по полям."""
    return Config(
        min_views=rules.min_views,
        min_ctr=rules.min_ctr,
        weak_campaign_ctr=rules.weak_campaign_ctr,
        min_carts_to_protect=rules.min_carts_to_protect,
        top_keep_pct=rules.top_keep_pct,
        min_clusters_alive=rules.min_clusters_alive,
        use_dynamic_ctr=rules.use_dynamic_ctr,
        min_dynamic_ctr=rules.min_dynamic_ctr,
    )


def run_one_account(
    conn: psycopg.Connection,
    account: db.ActiveAccount,
    run_mode: str = "auto",  # 'preview'|'auto'|'manual' — пишется в runs.mode
) -> AccountRunSummary:
    """Один прогон по одному аккаунту. Открывает run, записывает решения,
    закрывает run. Возвращает агрегированный итог."""
    started = time.time()
    run_id = db.create_run(conn, account.id, run_mode)
    summary = AccountRunSummary(
        account_id=account.id,
        run_id=run_id,
        status="running",
        skipped_preview=account.is_preview,
    )

    try:
        api = WBAdvertAPI(account.token)
        analyzer = ClusterAnalyzer(_config_from_rules(account.rules))
        # dry_run=True в preview ⇒ set-minus в WB не вызывается, ровно
        # то поведение, которого требует инвариант.
        optimizer = WBClusterOptimizer(api, analyzer, dry_run=account.is_preview)
        # Подменяем JSON-кэш на БД-aware версию. Старый MinusCache читал
        # minus_cache.json — здесь его место занимает наш DBMinusCache.
        optimizer.minus_cache = DBMinusCache(conn, account.id)

        # Сам прогон. wb_cluster_optimizer уже умеет всё — батчинг, rate
        # limiting, защита корзинами, гарантия минимума.
        reports = optimizer.run()

        # Конвертируем CampaignReport-ы в строки таблицы decisions.
        records: list[db.DecisionRecord] = []
        clusters_count = 0
        exclude_count = 0
        keep_count = 0

        for rep in reports:
            for decision in rep.decisions:
                cl = decision.cluster
                # nm_id привязан к кластеру опосредованно: в старом коде
                # decisions создаются в _process_nm, где известен nm_id.
                # Кладём его в Decision не было — но он есть в CampaignReport.nm_ids.
                # Если в репорте несколько nm_ids, каждое решение принадлежит
                # одному из них. В старом коде Decision не хранил nm_id явно;
                # сейчас примем первый из nm_ids как первичный — это допустимо
                # для текущего ядра, где per-кампания обычно один nm_id.
                nm_id = rep.nm_ids[0] if rep.nm_ids else 0
                was_applied = (
                    decision.action == "exclude"
                    and not account.is_preview
                )
                if was_applied:
                    summary.applied += 1
                records.append(
                    db.DecisionRecord(
                        advert_id=rep.advert_id,
                        nm_id=nm_id,
                        norm_query=cl.norm_query,
                        action=decision.action,
                        reason_code=rule_to_code(decision.rule),
                        ctr=cl.ctr,
                        views=cl.views,
                        clicks=cl.clicks,
                        carts=cl.carts,
                        orders=cl.orders,
                        was_applied=was_applied,
                    )
                )
                clusters_count += 1
                if decision.action == "exclude":
                    exclude_count += 1
                else:
                    keep_count += 1

        inserted = db.record_decisions(conn, run_id, records)
        log.info(
            "account=%s run=%s decisions_inserted=%d",
            account.name,
            run_id,
            inserted,
        )

        summary.campaigns_total = len(reports)
        summary.campaigns_processed = sum(1 for r in reports if r.decisions)
        summary.clusters_analyzed = clusters_count
        summary.decisions_exclude = exclude_count
        summary.decisions_keep = keep_count
        summary.status = "succeeded"

    except Exception as exc:  # noqa: BLE001 — хотим явный fail с записью
        log.exception("Прогон провалился для аккаунта %s", account.name)
        summary.status = "failed"
        summary.error = str(exc)
    finally:
        summary.processing_time_sec = time.time() - started
        db.finish_run(
            conn,
            run_id,
            status=summary.status,
            summary={
                "campaignsTotal": summary.campaigns_total,
                "campaignsProcessed": summary.campaigns_processed,
                "clustersAnalyzed": summary.clusters_analyzed,
                "decisionsExclude": summary.decisions_exclude,
                "decisionsKeep": summary.decisions_keep,
                "applied": summary.applied,
                "skippedPreview": summary.skipped_preview,
                "processingTimeSec": summary.processing_time_sec,
            },
            error=summary.error,
        )
        # In-app уведомление о прогоне.
        try:
            db.push_in_app_notification(
                conn,
                account.user_id,
                {
                    "kind": "run_summary",
                    "runId": run_id,
                    "accountId": account.id,
                    "accountName": account.name,
                    "status": summary.status,
                    "applied": summary.applied,
                    "preview": summary.skipped_preview,
                },
            )
        except Exception:
            log.exception("push_in_app_notification failed (non-fatal)")

    return summary


def run_all_active_accounts(conn: psycopg.Connection) -> list[AccountRunSummary]:
    """Главная точка входа для cron. Запускает прогон по всем активным."""
    accounts = db.load_active_accounts(conn)
    if not accounts:
        log.warning("Нет активных WB-аккаунтов в БД — нечего обрабатывать")
        return []

    results: list[AccountRunSummary] = []
    for acc in accounts:
        log.info(
            "Старт аккаунта name=%s mode=%s rules=%s",
            acc.name,
            acc.mode,
            acc.rules.name,
        )
        results.append(run_one_account(conn, acc, run_mode=acc.mode))
    return results
