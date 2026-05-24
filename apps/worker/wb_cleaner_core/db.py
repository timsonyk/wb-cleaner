"""psycopg3 sync клиент к Postgres. Заменяет старый config.json/JSON-отчёты.

Контракт:
- Используем connection pool (psycopg_pool) — для batch-job этого хватает.
- Все функции pyrhon-side не дают сырому токену утечь: расшифровка только в
  load_active_accounts и только в возвращаемом dict.
- Идемпотентность minus_cache на уровне БД (ON CONFLICT DO NOTHING).
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

from . import crypto

# python-dotenv: грузим .env из корня монорепо и локальный (если есть).
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT_ENV = os.path.abspath(os.path.join(_HERE, "..", "..", "..", ".env"))
_LOCAL_ENV = os.path.abspath(os.path.join(_HERE, "..", ".env"))
load_dotenv(_ROOT_ENV, override=False)
load_dotenv(_LOCAL_ENV, override=False)


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Короткое подключение. Для batch-job pool не нужен — одно соединение
    на прогон. autocommit=False, чтобы транзакции были явными."""
    conn = psycopg.connect(get_database_url(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Аккаунты + правила
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class RulesProfile:
    id: str
    name: str
    min_views: int
    min_ctr: float
    weak_campaign_ctr: float
    min_carts_to_protect: int
    top_keep_pct: float
    min_clusters_alive: int
    banned_keywords: list[str]
    use_dynamic_ctr: bool
    min_dynamic_ctr: float


@dataclass
class ActiveAccount:
    """Один WB-аккаунт, готовый к прогону. Токен УЖЕ расшифрован."""

    id: str
    user_id: str
    name: str
    token: str  # plaintext, в логах не показывать!
    mode: str  # 'preview' | 'auto'
    is_preview: bool
    rules: RulesProfile

    def __repr__(self) -> str:  # маскируем токен в repr на всякий случай
        return (
            f"ActiveAccount(id={self.id}, name={self.name!r}, "
            f"mode={self.mode}, token={crypto.mask_token(self.token)})"
        )


def load_active_accounts(conn: psycopg.Connection) -> list[ActiveAccount]:
    """Загрузить все is_active=true аккаунты с расшифрованным токеном и
    приклеенным правилом. Если правил не назначено — присоединяем дефолтный
    пресет (его id берётся по имени из DEFAULT_PRESET_NAME).

    Никаких сетевых запросов — только БД."""
    from . import DEFAULT_PRESET_NAME

    sql = """
        SELECT
            a.id::text                  AS account_id,
            a.user_id::text             AS user_id,
            a.name                      AS account_name,
            a.encrypted_token           AS ct,
            a.token_iv                  AS iv,
            a.token_tag                 AS tag,
            a.mode                      AS mode,
            COALESCE(r.id, dp.id)::text AS rules_id,
            COALESCE(r.name, dp.name)   AS rules_name,
            COALESCE(r.min_views, dp.min_views)               AS min_views,
            COALESCE(r.min_ctr, dp.min_ctr)                   AS min_ctr,
            COALESCE(r.weak_campaign_ctr, dp.weak_campaign_ctr) AS weak_campaign_ctr,
            COALESCE(r.min_carts_to_protect, dp.min_carts_to_protect) AS min_carts_to_protect,
            COALESCE(r.top_keep_pct, dp.top_keep_pct)         AS top_keep_pct,
            COALESCE(r.min_clusters_alive, dp.min_clusters_alive) AS min_clusters_alive,
            COALESCE(r.banned_keywords, dp.banned_keywords)   AS banned_keywords,
            COALESCE(r.use_dynamic_ctr, dp.use_dynamic_ctr)   AS use_dynamic_ctr,
            COALESCE(r.min_dynamic_ctr, dp.min_dynamic_ctr)   AS min_dynamic_ctr
        FROM wb_accounts a
        LEFT JOIN wb_account_rules ar ON ar.wb_account_id = a.id
        LEFT JOIN rules_profiles   r  ON r.id = ar.rules_profile_id
        LEFT JOIN rules_profiles   dp ON dp.is_preset = true AND dp.name = %s
        WHERE a.is_active = true
        ORDER BY a.created_at;
    """
    out: list[ActiveAccount] = []
    with conn.cursor() as cur:
        cur.execute(sql, (DEFAULT_PRESET_NAME,))
        rows = cur.fetchall()
    for row in rows:
        token = crypto.decrypt_token(
            crypto.EncryptedToken(ciphertext=row["ct"], iv=row["iv"], tag=row["tag"])
        )
        # banned_keywords хранится jsonb → psycopg возвращает уже list.
        bk = row["banned_keywords"]
        if isinstance(bk, str):
            bk = json.loads(bk)
        rules = RulesProfile(
            id=row["rules_id"],
            name=row["rules_name"],
            min_views=row["min_views"],
            min_ctr=float(row["min_ctr"]),
            weak_campaign_ctr=float(row["weak_campaign_ctr"]),
            min_carts_to_protect=row["min_carts_to_protect"],
            top_keep_pct=float(row["top_keep_pct"]),
            min_clusters_alive=row["min_clusters_alive"],
            banned_keywords=bk or [],
            use_dynamic_ctr=row["use_dynamic_ctr"],
            min_dynamic_ctr=float(row["min_dynamic_ctr"]),
        )
        out.append(
            ActiveAccount(
                id=row["account_id"],
                user_id=row["user_id"],
                name=row["account_name"],
                token=token,
                mode=row["mode"],
                is_preview=(row["mode"] == "preview"),
                rules=rules,
            )
        )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Runs
# ─────────────────────────────────────────────────────────────────────────────


def create_run(conn: psycopg.Connection, account_id: str, mode: str) -> str:
    """Создать run в статусе running. mode = preview|auto|manual."""
    sql = """
        INSERT INTO runs (wb_account_id, mode, status, started_at)
        VALUES (%s, %s, 'running', now())
        RETURNING id::text
    """
    with conn.cursor() as cur:
        cur.execute(sql, (account_id, mode))
        result = cur.fetchone()
        if not result:
            raise RuntimeError("create_run: insert did not return id")
        return result["id"]


def finish_run(
    conn: psycopg.Connection,
    run_id: str,
    status: str,
    summary: dict | None = None,
    error: str | None = None,
) -> None:
    """status = succeeded|failed|partial. summary в jsonb, error в text."""
    sql = """
        UPDATE runs
           SET finished_at = now(),
               status      = %s,
               summary     = %s::jsonb,
               error_text  = %s
         WHERE id = %s
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            (status, json.dumps(summary or {}, ensure_ascii=False), error, run_id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Decisions
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class DecisionRecord:
    advert_id: int
    nm_id: int
    norm_query: str
    action: str  # 'keep'|'exclude'
    reason_code: str  # из reason_code enum
    ctr: float | None = None
    views: int | None = None
    clicks: int | None = None
    carts: int | None = None
    orders: int | None = None
    was_applied: bool = False


def record_decisions(
    conn: psycopg.Connection,
    run_id: str,
    decisions: Iterable[DecisionRecord],
    apply_timestamp: datetime | None = None,
) -> int:
    """Batch insert decisions. Возвращает число вставленных строк.
    apply_timestamp — если воркер реально применил эти решения в WB, то
    та же дата проставится в applied_at для was_applied=true решений."""
    rows = list(decisions)
    if not rows:
        return 0

    applied_at = apply_timestamp or datetime.now(timezone.utc)
    sql = """
        INSERT INTO decisions
          (run_id, advert_id, nm_id, norm_query, action, reason_code,
           ctr, views, clicks, carts, orders, was_applied, applied_at)
        VALUES
          (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    inserted = 0
    with conn.cursor() as cur:
        for d in rows:
            cur.execute(
                sql,
                (
                    run_id,
                    d.advert_id,
                    d.nm_id,
                    d.norm_query,
                    d.action,
                    d.reason_code,
                    d.ctr,
                    d.views,
                    d.clicks,
                    d.carts,
                    d.orders,
                    d.was_applied,
                    applied_at if d.was_applied else None,
                ),
            )
            inserted += 1
    return inserted


# ─────────────────────────────────────────────────────────────────────────────
# Minus cache
# ─────────────────────────────────────────────────────────────────────────────


def get_minus_cache(
    conn: psycopg.Connection,
    account_id: str,
) -> set[tuple[int, int, str]]:
    """Все уже заминусованные пары (advert_id, nm_id, phrase_lower) для аккаунта.

    Phrase нормализован к нижнему регистру — это и есть форма, по которой
    воркер проверяет «новая фраза vs уже минусованная»."""
    sql = """
        SELECT advert_id, nm_id, lower(phrase) AS phrase
          FROM minus_cache
         WHERE wb_account_id = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (account_id,))
        return {(int(r["advert_id"]), int(r["nm_id"]), r["phrase"]) for r in cur.fetchall()}


def upsert_minus_cache(
    conn: psycopg.Connection,
    account_id: str,
    entries: Iterable[tuple[int, int, str]],
) -> int:
    """ON CONFLICT DO NOTHING. Возвращает число НОВЫХ строк."""
    rows = list(entries)
    if not rows:
        return 0
    sql = """
        INSERT INTO minus_cache (wb_account_id, advert_id, nm_id, phrase)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT minus_cache_pk DO NOTHING
    """
    inserted = 0
    with conn.cursor() as cur:
        for advert_id, nm_id, phrase in rows:
            cur.execute(sql, (account_id, advert_id, nm_id, phrase))
            inserted += cur.rowcount
    return inserted


# ─────────────────────────────────────────────────────────────────────────────
# Notifications (in-app only — пишем в БД, UI читает потом)
# ─────────────────────────────────────────────────────────────────────────────


def push_in_app_notification(
    conn: psycopg.Connection,
    user_id: str,
    payload: dict,
) -> None:
    """Кладёт уведомление в таблицу со статусом 'sent' (in-app считаем
    доставленным сразу — UI прочитает при следующем заходе). target пустой —
    in_app не требует адреса."""
    sql = """
        INSERT INTO notifications (user_id, channel, target, payload, status, sent_at)
        VALUES (%s, 'in_app', %s, %s::jsonb, 'sent', now())
    """
    with conn.cursor() as cur:
        cur.execute(sql, (user_id, "", json.dumps(payload, ensure_ascii=False)))
