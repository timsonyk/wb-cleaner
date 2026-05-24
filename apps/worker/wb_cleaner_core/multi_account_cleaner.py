#!/usr/bin/env python3
"""
WB Multi-Account Cluster Cleaner
================================
Чистит кластеры для нескольких аккаунтов WB и отправляет статистику push-уведомлением (ntfy).

Запуск:
  python multi_account_cleaner.py           # Обработать все аккаунты
  python multi_account_cleaner.py --dry-run # Тестовый режим (без изменений)
  python multi_account_cleaner.py --account БИА  # Только один аккаунт
"""

import json
import re
import requests
import time
import argparse
from datetime import datetime, timezone, timedelta

# Московское время (UTC+3)
MSK = timezone(timedelta(hours=3))
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# Импортируем основной оптимизатор
from wb_cluster_optimizer import WBAdvertAPI, WBClusterOptimizer, ClusterAnalyzer, Config


# ──────────────────────────────────────────────────────────
# Конфигурация
# ──────────────────────────────────────────────────────────

CONFIG_FILE = Path(__file__).parent / "config.json"
HISTORY_FILE = Path(__file__).parent / "cleaning_history.json"


@dataclass
class CampaignDetail:
    """Детали обработки одной кампании."""
    name: str
    excluded: int = 0         # всего к удалению в текущем анализе
    new_excluded: int = 0     # действительно новых (не было в кэше)
    kept: int = 0
    is_weak: bool = False
    renamed: bool = False
    median_ctr: float = 0.0
    total_views: int = 0
    total_clicks: int = 0
    excluded_views: int = 0   # показы на удалённых кластерах
    # Новая статистика по минус-фразам
    total_minus: int = 0      # всего в минус-фразах
    from_cache: int = 0       # было в кэше


@dataclass
class AccountResult:
    """Результат обработки одного аккаунта."""
    name: str
    campaigns_total: int = 0
    campaigns_processed: int = 0
    campaigns_skipped: int = 0
    clusters_total: int = 0
    clusters_excluded: int = 0      # действительно новых (которых не было в кэше)
    clusters_kept: int = 0
    errors: list = field(default_factory=list)
    weak_campaigns: int = 0
    renamed_campaigns: int = 0
    processing_time: float = 0.0
    campaign_details: list = field(default_factory=list)  # список CampaignDetail

    # Статистика по минус-фразам
    total_minus: int = 0           # всего в минус-фразах (кэш + новые)
    from_cache: int = 0            # было в кэше

    # Расширенная статистика
    total_views: int = 0           # общее количество показов
    total_clicks: int = 0          # общее количество кликов
    excluded_views: int = 0        # показы на удалённых кластерах
    clusters_with_carts: int = 0   # кластеры с корзинами (защищённые)
    clusters_low_ctr: int = 0      # удалено по низкому CTR
    clusters_forbidden: int = 0    # удалено по запрещённым словам
    clusters_insufficient: int = 0 # недостаточно данных (оставлены)
    sum_ctr_excluded: float = 0.0   # сумма CTR удалённых (для взвешенного среднего)
    count_ctr_excluded: int = 0     # количество удалённых кластеров (для взвешенного среднего)
    sum_ctr_kept: float = 0.0       # сумма CTR оставленных (для взвешенного среднего)
    count_ctr_kept: int = 0         # количество оставленных кластеров (для взвешенного среднего)


@dataclass
class CleaningReport:
    """Общий отчёт по чистке всех аккаунтов."""
    date: str
    accounts: list[AccountResult] = field(default_factory=list)
    total_time: float = 0.0

    @property
    def total_campaigns(self) -> int:
        return sum(a.campaigns_processed for a in self.accounts)

    @property
    def total_excluded(self) -> int:
        """Новых удалено (по анализу)."""
        return sum(a.clusters_excluded for a in self.accounts)

    @property
    def total_minus(self) -> int:
        """Всего в минус-фразах (кэш + новые)."""
        return sum(a.total_minus for a in self.accounts)

    @property
    def total_from_cache(self) -> int:
        """Было в кэше."""
        return sum(a.from_cache for a in self.accounts)

    @property
    def total_errors(self) -> int:
        return sum(len(a.errors) for a in self.accounts)


# ──────────────────────────────────────────────────────────
# Notifier (ntfy.sh — Telegram заблокирован в РФ)
# ──────────────────────────────────────────────────────────

class NtfyNotifier:
    """Отправляет push-уведомления через ntfy.sh."""

    _TAG_RE = re.compile(r"<[^>]+>")

    def __init__(self, server: str, topic: str):
        self.url = f"{server.rstrip('/')}/{topic}"

    def send_message(self, text: str, parse_mode: str = None, to_group: bool = True) -> bool:
        """Отправить сообщение. parse_mode/to_group — для совместимости со старой сигнатурой."""
        body = self._TAG_RE.sub("", text)
        try:
            resp = requests.post(
                self.url,
                data=body.encode("utf-8"),
                headers={"Title": "WB Cleaner", "Priority": "default"},
                timeout=30,
            )
            return resp.status_code == 200
        except Exception as e:
            print(f"Ошибка отправки в ntfy: {e}")
            return False

    def send_report(self, report: CleaningReport) -> bool:
        """Отправить отчёт о чистке."""

        # ════════════════════════════════════════════════════════════
        # СООБЩЕНИЕ 1: Основная статистика
        # ════════════════════════════════════════════════════════════

        # Агрегируем данные по всем аккаунтам
        total_views = sum(a.total_views for a in report.accounts)
        total_clicks = sum(a.total_clicks for a in report.accounts)
        total_excluded_views = sum(a.excluded_views for a in report.accounts)
        total_kept = sum(a.clusters_kept for a in report.accounts)
        total_clusters = sum(a.clusters_total for a in report.accounts)
        total_low_ctr = sum(a.clusters_low_ctr for a in report.accounts)
        total_forbidden = sum(a.clusters_forbidden for a in report.accounts)
        total_with_carts = sum(a.clusters_with_carts for a in report.accounts)
        total_insufficient = sum(a.clusters_insufficient for a in report.accounts)
        total_weak = sum(a.weak_campaigns for a in report.accounts)
        total_renamed = sum(a.renamed_campaigns for a in report.accounts)

        # Считаем взвешенные средние CTR
        total_sum_ctr_excl = sum(a.sum_ctr_excluded for a in report.accounts)
        total_count_excl = sum(a.count_ctr_excluded for a in report.accounts)
        total_sum_ctr_kept = sum(a.sum_ctr_kept for a in report.accounts)
        total_count_kept = sum(a.count_ctr_kept for a in report.accounts)

        avg_ctr_excl = total_sum_ctr_excl / total_count_excl if total_count_excl > 0 else 0
        avg_ctr_kept = total_sum_ctr_kept / total_count_kept if total_count_kept > 0 else 0

        # Процент удалённых показов
        views_pct = (total_excluded_views / total_views * 100) if total_views > 0 else 0

        lines = [
            f"<b>🧹 WB Cluster Cleaner</b>",
            f"📅 {report.date}  ⏱ {report.total_time:.0f}с",
            "",
            f"<b>📊 ОБЩИЙ ИТОГ</b>",
            f"├ Кампаний обработано: {report.total_campaigns} (слабых: {total_weak})",
            f"├ Переименовано: {total_renamed} 📝",
            f"├ Кластеров проанализировано: {total_clusters}",
            f"│   ├ Оставлено: {total_kept}",
            f"│   └ Новых на удаление: {report.total_excluded}",
            "",
            f"<b>🚫 МИНУС-ФРАЗЫ</b>",
            f"├ Всего в минусах: <b>{report.total_minus}</b>",
            f"├ Новых: {report.total_excluded}",
            f"└ Из кэша: {report.total_from_cache}",
            "",
            f"<b>👁 ПОКАЗЫ И КЛИКИ</b>",
            f"├ Всего показов: {total_views:,}".replace(",", " "),
            f"├ Удалено показов: {total_excluded_views:,} ({views_pct:.1f}%)".replace(",", " "),
            f"└ Всего кликов: {total_clicks:,}".replace(",", " "),
            "",
            f"<b>📈 CTR АНАЛИЗ</b>",
            f"├ Средний CTR удалённых: {avg_ctr_excl:.2f}%",
            f"└ Средний CTR оставленных: {avg_ctr_kept:.2f}%",
            "",
            f"<b>🏷 ПО ПРИЧИНАМ</b>",
            f"├ Низкий CTR: {total_low_ctr}",
            f"├ Запрещённые слова: {total_forbidden}",
            f"├ Защищены (корзины/заказы): {total_with_carts}",
            f"└ Мало данных: {total_insufficient}",
        ]

        message = "\n".join(lines)
        self.send_message(message)

        # ════════════════════════════════════════════════════════════
        # СООБЩЕНИЕ 2: Детали по аккаунтам
        # ════════════════════════════════════════════════════════════

        acc_lines = ["<b>👤 ДЕТАЛИ ПО АККАУНТАМ</b>", ""]

        for acc in report.accounts:
            status = "✅" if not acc.errors else "⚠️"
            acc_ctr = (acc.total_clicks / acc.total_views * 100) if acc.total_views > 0 else 0

            acc_lines.append(f"<b>{status} {acc.name}</b>")
            acc_lines.append(f"├ Кампаний: {acc.campaigns_processed}/{acc.campaigns_total}")
            acc_lines.append(f"├ Минус-фразы: <b>{acc.total_minus}</b> (новых: {acc.clusters_excluded}, кэш: {acc.from_cache})")
            acc_lines.append(f"├ Показы: {acc.total_views:,} (удал: {acc.excluded_views:,})".replace(",", " "))
            acc_lines.append(f"├ CTR аккаунта: {acc_ctr:.2f}%")
            if acc.weak_campaigns:
                acc_lines.append(f"├ Слабых РК: {acc.weak_campaigns}")
            if acc.renamed_campaigns:
                acc_lines.append(f"├ Переименовано: {acc.renamed_campaigns} 📝")
            if acc.errors:
                acc_lines.append(f"└ Ошибок: {len(acc.errors)} ⚠️")
            else:
                acc_lines.append(f"└ Время: {acc.processing_time:.0f}с")
            acc_lines.append("")

        acc_message = "\n".join(acc_lines)
        if len(acc_message) > 4000:
            acc_message = acc_message[:4000] + "\n..."
        self.send_message(acc_message)

        # ════════════════════════════════════════════════════════════
        # СООБЩЕНИЕ 3: Топ кампаний по удалённым кластерам
        # ════════════════════════════════════════════════════════════

        all_details = []
        for acc in report.accounts:
            for d in acc.campaign_details:
                all_details.append((acc.name, d))

        if all_details:
            # Топ-10 по минус-фразам
            top_by_minus = sorted(all_details, key=lambda x: x[1].total_minus, reverse=True)[:10]

            camp_lines = ["<b>🏆 ТОП-10 ПО МИНУС-ФРАЗАМ</b>", ""]
            for i, (acc_name, d) in enumerate(top_by_minus, 1):
                weak = " ⚠️" if d.is_weak else ""
                short_name = d.name[:20] + "..." if len(d.name) > 20 else d.name
                camp_lines.append(
                    f"{i}. [{acc_name}] {short_name}"
                )
                camp_lines.append(
                    f"   🚫{d.total_minus} (новых: {d.new_excluded}) | CTR {d.median_ctr:.1f}%{weak}"
                )

            # Худшие по CTR (если есть данные)
            campaigns_with_ctr = [(acc, d) for acc, d in all_details if d.median_ctr > 0]
            if campaigns_with_ctr:
                camp_lines.append("")
                camp_lines.append("<b>📉 ХУДШИЕ ПО CTR</b>")
                worst_by_ctr = sorted(campaigns_with_ctr, key=lambda x: x[1].median_ctr)[:5]
                for acc_name, d in worst_by_ctr:
                    short_name = d.name[:20] + "..." if len(d.name) > 20 else d.name
                    camp_lines.append(f"• [{acc_name}] {short_name}: {d.median_ctr:.2f}%")

            camp_message = "\n".join(camp_lines)
            if len(camp_message) > 4000:
                camp_message = camp_message[:4000] + "\n..."
            self.send_message(camp_message)

        return True

    def _load_history(self) -> list:
        """Загрузить историю чисток."""
        if HISTORY_FILE.exists():
            try:
                with open(HISTORY_FILE) as f:
                    return json.load(f)
            except:
                pass
        return []


# ──────────────────────────────────────────────────────────
# Мульти-аккаунт обработчик
# ──────────────────────────────────────────────────────────

class MultiAccountCleaner:
    """Обрабатывает несколько аккаунтов WB."""

    def __init__(self, config_path: Path = CONFIG_FILE, dry_run: bool = False):
        self.dry_run = dry_run
        self.config = self._load_config(config_path)
        self.notifier = NtfyNotifier(
            self.config["ntfy"]["server"],
            self.config["ntfy"]["topic"],
        )

    def _load_config(self, path: Path) -> dict:
        """Загрузить конфигурацию."""
        with open(path) as f:
            return json.load(f)

    def process_account(self, account: dict) -> AccountResult:
        """Обработать один аккаунт."""
        name = account["name"]
        token = account["token"]

        print(f"\n{'='*60}")
        print(f"  АККАУНТ: {name}")
        print(f"{'='*60}")

        result = AccountResult(name=name)
        start_time = time.time()

        try:
            # Создаём API и оптимизатор
            api = WBAdvertAPI(token)
            config = Config()  # Дефолтная конфигурация
            analyzer = ClusterAnalyzer(config)
            optimizer = WBClusterOptimizer(api, analyzer, dry_run=self.dry_run)

            # Запускаем оптимизацию
            reports = optimizer.run()

            # Агрегаторы для расчёта средних CTR
            excluded_ctrs = []
            kept_ctrs = []

            # Собираем статистику
            for r in reports:
                result.campaigns_total += 1

                excluded_count = len(r.to_exclude) if r.to_exclude else 0
                kept_count = len(r.to_keep) if r.to_keep else 0
                renamed = r.new_name and r.new_name != r.old_name

                # Статистика по минус-фразам (новая логика)
                result.total_minus += r.total_minus
                result.from_cache += r.from_cache

                # Кампания считается обработанной если была хоть какая-то работа:
                # минусы, новые исключения ИЛИ успешное переименование.
                # Раньше учитывались только минусы — переименования терялись в статистике.
                if r.total_minus > 0 or excluded_count > 0 or renamed:
                    result.campaigns_processed += 1
                    result.clusters_excluded += r.new_excluded  # только действительно новые
                else:
                    result.campaigns_skipped += 1

                result.clusters_total += len(r.decisions)
                result.clusters_kept += kept_count
                result.errors.extend(r.errors)

                if r.is_weak:
                    result.weak_campaigns += 1

                if renamed:
                    result.renamed_campaigns += 1

                # Расширенная статистика по кластерам
                campaign_views = 0
                campaign_clicks = 0
                campaign_excluded_views = 0

                for d in r.decisions:
                    cluster = d.cluster
                    campaign_views += cluster.views
                    campaign_clicks += cluster.clicks

                    if d.action == "exclude":
                        campaign_excluded_views += cluster.views
                        excluded_ctrs.append(cluster.ctr)

                        # Статистика по причинам удаления
                        if d.rule == "низкий CTR без корзин":
                            result.clusters_low_ctr += 1
                        elif d.rule == "запрещённое слово":
                            result.clusters_forbidden += 1
                    else:  # keep
                        kept_ctrs.append(cluster.ctr)

                        # Статистика по причинам сохранения
                        if d.rule == "защита корзиной" or d.rule == "защита заказом":
                            result.clusters_with_carts += 1
                        elif d.rule == "недостаточно данных":
                            result.clusters_insufficient += 1

                result.total_views += campaign_views
                result.total_clicks += campaign_clicks
                result.excluded_views += campaign_excluded_views

                # Сохраняем детали кампании (только если были изменения)
                if r.total_minus > 0 or renamed:
                    detail = CampaignDetail(
                        name=r.old_name or f"ID:{r.advert_id}",
                        excluded=excluded_count,
                        new_excluded=r.new_excluded,
                        kept=kept_count,
                        is_weak=r.is_weak,
                        renamed=renamed,
                        median_ctr=r.median_ctr,
                        total_views=campaign_views,
                        total_clicks=campaign_clicks,
                        excluded_views=campaign_excluded_views,
                        total_minus=r.total_minus,
                        from_cache=r.from_cache
                    )
                    result.campaign_details.append(detail)

            # Вычисляем средние CTR
            if excluded_ctrs:
                result.sum_ctr_excluded = sum(excluded_ctrs)
                result.count_ctr_excluded = len(excluded_ctrs)
            if kept_ctrs:
                result.sum_ctr_kept = sum(kept_ctrs)
                result.count_ctr_kept = len(kept_ctrs)

        except Exception as e:
            result.errors.append(f"Критическая ошибка: {e}")
            print(f"❌ Ошибка обработки аккаунта {name}: {e}")

        result.processing_time = time.time() - start_time

        print(f"\n  Результат {name}:")
        print(f"    Кампаний: {result.campaigns_processed}")
        print(f"    Удалено: {result.clusters_excluded} кластеров")
        print(f"    Время: {result.processing_time:.1f} сек")

        return result

    def run(self, account_filter: Optional[str] = None) -> CleaningReport:
        """Обработать все аккаунты."""

        report = CleaningReport(
            date=datetime.now(MSK).strftime("%d.%m.%Y %H:%M")
        )

        start_time = time.time()

        # Отправляем уведомление о начале
        mode = "🧪 ТЕСТ" if self.dry_run else "⚡ БОЕВОЙ"
        self.notifier.send_message(
            f"<b>🚀 Запуск WB Cluster Cleaner</b>\n"
            f"📅 {report.date}\n"
            f"🔧 Режим: {mode}\n"
            f"📦 Аккаунтов: {len(self.config['accounts'])}"
        )

        # Обрабатываем аккаунты
        for account in self.config["accounts"]:
            if account_filter and account["name"] != account_filter:
                continue

            result = self.process_account(account)
            report.accounts.append(result)

            # Пауза между аккаунтами
            time.sleep(2)

        report.total_time = time.time() - start_time

        # Сохраняем историю
        self._save_history(report)

        # Отправляем итоговый отчёт
        self.notifier.send_report(report)

        return report

    def _save_history(self, report: CleaningReport):
        """Сохранить историю чисток."""
        history = []
        if HISTORY_FILE.exists():
            try:
                with open(HISTORY_FILE) as f:
                    history = json.load(f)
            except:
                pass

        # Добавляем новую запись
        history.append({
            "date": report.date,
            "total_campaigns": report.total_campaigns,
            "total_excluded": report.total_excluded,
            "total_minus": report.total_minus,
            "total_from_cache": report.total_from_cache,
            "total_errors": report.total_errors,
            "total_time": report.total_time,
            "accounts": [
                {
                    "name": a.name,
                    "campaigns": a.campaigns_processed,
                    "excluded": a.clusters_excluded,
                    "renamed": a.renamed_campaigns,
                    "total_minus": a.total_minus,
                    "from_cache": a.from_cache,
                    "errors": len(a.errors),
                }
                for a in report.accounts
            ]
        })

        # Храним последние 30 запусков
        history = history[-30:]

        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────────────────
# Итоговый отчёт в консоль
# ──────────────────────────────────────────────────────────

def print_summary(report: CleaningReport):
    """Вывести итоговый отчёт."""

    print("\n")
    print("╔" + "═"*62 + "╗")
    print("║" + "ИТОГОВЫЙ ОТЧЁТ ПО ВСЕМ АККАУНТАМ".center(62) + "║")
    print("╠" + "═"*62 + "╣")

    for acc in report.accounts:
        status = "✅" if not acc.errors else "⚠️"
        print(f"║  {status} {acc.name:<10} │ Кампаний: {acc.campaigns_processed:>3} │ "
              f"Минусов: {acc.total_minus:>4} (новых: {acc.clusters_excluded:>3})  ║")

    print("╠" + "═"*62 + "╣")
    print(f"║  {'ВСЕГО:':<12} │ Кампаний: {report.total_campaigns:>3} │ "
          f"Минусов: {report.total_minus:>4} (новых: {report.total_excluded:>3})  ║")
    print(f"║  {'Время:':<12} │ {report.total_time:>6.1f} сек"
          f"{' '*34}║")
    print("╚" + "═"*62 + "╝")


# ──────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="WB Multi-Account Cluster Cleaner"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Тестовый режим (без реальных изменений)"
    )
    parser.add_argument(
        "--account",
        type=str,
        help="Обработать только указанный аккаунт (БИА, Ерко, Ств, ШВС)"
    )
    parser.add_argument(
        "--no-notify",
        action="store_true",
        help="Не отправлять push-уведомления"
    )

    args = parser.parse_args()

    print("\n")
    print("╔" + "═"*58 + "╗")
    print("║" + "WB MULTI-ACCOUNT CLUSTER CLEANER".center(58) + "║")
    print("╚" + "═"*58 + "╝")
    print(f"  Дата: {datetime.now(MSK).strftime('%d.%m.%Y %H:%M')}")
    print(f"  Режим: {'🧪 ТЕСТ' if args.dry_run else '⚡ БОЕВОЙ'}")

    cleaner = MultiAccountCleaner(dry_run=args.dry_run)

    if args.no_notify:
        cleaner.notifier.send_message = lambda *a, **k: True
        cleaner.notifier.send_report = lambda *a, **k: True

    report = cleaner.run(account_filter=args.account)

    print_summary(report)


if __name__ == "__main__":
    main()
