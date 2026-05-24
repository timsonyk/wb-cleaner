"""
WB Cluster Optimizer — автоматическая чистка неэффективных кластеров запросов
в рекламных кампаниях Wildberries.

Формула:
  1. Кластер с ≥40 показов, CTR < 4%, 0 корзин → УДАЛИТЬ
  2. Если есть хотя бы 1 корзина → ОСТАВИТЬ (защита)
  3. Если вся кампания «слабая» (медиана CTR < порога) → оставить топ-20% по CTR
  4. Гарантия: минимум 3 кластера всегда остаются в кампании

Использование:
  python wb_cluster_optimizer.py --token YOUR_API_TOKEN [--dry-run]
  python wb_cluster_optimizer.py --token YOUR_API_TOKEN --min-views 40 --min-ctr 4.0

Автор: SELYUTIN
"""

import argparse
import json
import logging
import math
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# Московское время (UTC+3)
MSK = timezone(timedelta(hours=3))
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:
    print("Установите requests: pip install requests")
    sys.exit(1)


def load_env_file():
    """Загружает переменные из .env файла в os.environ."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return

    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


load_env_file()

# ──────────────────────────────────────────────────────────
# Конфигурация
# ──────────────────────────────────────────────────────────

BASE_URL = "https://advert-api.wildberries.ru"
RATE_LIMIT_DELAY = 0.35  # секунд между запросами


@dataclass
class Config:
    """Настройки оптимизатора."""
    min_views: int = 40           # Минимум показов для принятия решения
    min_ctr: float = 2.5          # CTR ниже этого → кандидат на удаление (%)
    weak_campaign_ctr: float = 2.5  # Медиана CTR ниже этого → слабая кампания
    min_carts_to_protect: int = 1 # Сколько корзин защищают кластер
    top_keep_pct: float = 0.20    # Доля топ-кластеров при «слабой» кампании (20%)
    min_clusters_alive: int = 3   # Гарантированный минимум кластеров в кампании
    use_dynamic_ctr: bool = False  # Использовать динамический порог CTR (выключено — фикс. 2%)
    min_dynamic_ctr: float = 2.0  # Минимальный порог CTR при динамическом расчёте
    dynamic_ctr_factor: float = 0.7  # Множитель медианы для динамического порога


class MinusCache:
    """Локальный кэш заминусованных кластеров.

    Сохраняет историю успешных минусаций, чтобы не пытаться
    минусовать одни и те же кластеры повторно.
    """

    def __init__(self, cache_file: str = "minus_cache.json"):
        self.cache_file = Path(__file__).parent / cache_file
        self.data: dict[str, dict[str, list[str]]] = {}  # {advert_id: {nm_id: [queries]}}
        self._load()

    def _load(self):
        """Загружает кэш из файла."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except (json.JSONDecodeError, IOError):
                self.data = {}

    def _save(self):
        """Сохраняет кэш в файл."""
        try:
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except IOError as e:
            logging.error(f"Не удалось сохранить кэш: {e}")

    def get_excluded(self, advert_id: int, nm_id: int) -> set[str]:
        """Возвращает множество уже заминусованных кластеров."""
        adv_key = str(advert_id)
        nm_key = str(nm_id)
        if adv_key in self.data and nm_key in self.data[adv_key]:
            return {q.lower() for q in self.data[adv_key][nm_key]}
        return set()

    def add_excluded(self, advert_id: int, nm_id: int, queries: list[str]):
        """Добавляет заминусованные кластеры в кэш."""
        if not queries:
            return
        adv_key = str(advert_id)
        nm_key = str(nm_id)
        if adv_key not in self.data:
            self.data[adv_key] = {}
        if nm_key not in self.data[adv_key]:
            self.data[adv_key][nm_key] = []

        existing = set(q.lower() for q in self.data[adv_key][nm_key])
        for q in queries:
            if q.lower() not in existing:
                self.data[adv_key][nm_key].append(q)
                existing.add(q.lower())

        self._save()

    def get_stats(self) -> tuple[int, int]:
        """Возвращает (количество кампаний, общее количество минусов)."""
        total_campaigns = len(self.data)
        total_queries = sum(
            len(queries)
            for nms in self.data.values()
            for queries in nms.values()
        )
        return total_campaigns, total_queries


@dataclass
class Cluster:
    """Статистика одного кластера."""
    norm_query: str
    views: int = 0
    clicks: int = 0
    ctr: float = 0.0
    carts: int = 0
    orders: int = 0
    sum_price: float = 0.0
    source: str = "normquery"  # "normquery" или "keyword" — источник данных


@dataclass
class Decision:
    """Решение по кластеру."""
    cluster: Cluster
    action: str          # "keep" | "exclude"
    reason: str
    rule: str            # какое правило сработало


@dataclass
class CampaignReport:
    """Результат обработки одной кампании."""
    advert_id: int
    nm_ids: list = field(default_factory=list)
    decisions: list = field(default_factory=list)
    is_weak: bool = False
    median_ctr: float = 0.0
    errors: list = field(default_factory=list)
    old_name: str = ""
    new_name: str = ""
    # Новая статистика по минус-фразам
    total_minus: int = 0      # всего в минус-фразах (кэш + новые)
    new_excluded: int = 0     # новых (определено анализом)
    from_cache: int = 0       # было в кэше

    @property
    def to_exclude(self):
        return [d for d in self.decisions if d.action == "exclude"]

    @property
    def to_keep(self):
        return [d for d in self.decisions if d.action == "keep"]


# ──────────────────────────────────────────────────────────
# API-клиент
# ──────────────────────────────────────────────────────────

class WBAdvertAPI:
    """Обёртка над WB Promotion API."""

    def __init__(self, token: str):
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": token,
            "Content-Type": "application/json",
        })
        # Кэш деталей кампаний на сессию. WB лимитирует /api/advert/v2/adverts
        # до 1 запроса в час на seller, поэтому забираем сразу пачкой через
        # prefetch_adverts() и ходим в кэш.
        self._adverts_cache: dict[int, dict] = {}
        # Кэш статистики кластеров. /adv/v1/normquery/stats — тоже 1 запрос/час,
        # но принимает массив пар в items[]. prefetch_cluster_stats() собирает
        # все (advertId, nmId) пары аккаунта и забирает за один батч.
        self._cluster_cache: dict[tuple[int, int], list] = {}

    def _request(self, method: str, path: str, **kwargs) -> Optional[dict]:
        url = f"{BASE_URL}{path}"
        time.sleep(RATE_LIMIT_DELAY)

        try:
            resp = self.session.request(method, url, **kwargs)
        except requests.RequestException as e:
            logging.error(f"Ошибка сети: {e}")
            return None

        if resp.status_code == 429:
            # WB присылает x-ratelimit-retry/-reset, а не Retry-After.
            retry_after = int(
                resp.headers.get("Retry-After")
                or resp.headers.get("x-ratelimit-retry")
                or resp.headers.get("x-ratelimit-reset")
                or 60
            )
            # Потолок на ожидание: если сервер просит ждать > 20 мин — пропускаем
            # запрос. Иначе зависаем на часовом лимите (как было с
            # /api/advert/v2/adverts), и за прогон не успеваем по другим эндпоинтам.
            if retry_after > 1200:
                logging.warning(
                    f"Rate limit {retry_after}с (path={path}) — слишком долго, пропуск"
                )
                return None
            logging.warning(f"Rate limit! Ждём {retry_after}с (path={path})")
            time.sleep(retry_after + 1)
            return self._request(method, path, **kwargs)

        if resp.status_code == 204:
            return {}

        if resp.status_code not in (200, 201):
            logging.error(f"{method} {path} → {resp.status_code}: {resp.text[:300]}")
            return None

        try:
            return resp.json()
        except json.JSONDecodeError:
            return {}

    def get_campaigns(self, statuses: list[int] = None) -> list[dict]:
        """
        Получить кампании.
        GET /adv/v1/promotion/count — возвращает группы кампаний по типу/статусу
        statuses: список статусов (9=активные, 11=приостановленные, 7=завершённые)
                  если None — берём активные и приостановленные
        """
        if statuses is None:
            statuses = [9, 11]  # Активные и приостановленные

        count_data = self._request("GET", "/adv/v1/promotion/count")
        if not count_data:
            return []

        # Структура: {"adverts": [{"type": 9, "status": 9, "advert_list": [...]}]}
        campaigns = []
        adverts_groups = count_data.get("adverts", [])

        for group in adverts_groups:
            if group.get("status") in statuses:
                advert_list = group.get("advert_list", [])
                for advert in advert_list:
                    # Добавляем статус и тип к каждой кампании
                    advert["status"] = group.get("status")
                    advert["type"] = group.get("type")
                    campaigns.append(advert)

        return campaigns

    def prefetch_adverts(self, advert_ids: list[int]) -> int:
        """Загрузить детали всех кампаний пакетно (до 50 id за запрос).

        WB на /api/advert/v2/adverts держит лимит 1 запрос/час на seller.
        Поэтому берём не по одному id, а пачкой 50, и складываем в кэш.
        Возвращает число успешно закэшированных кампаний.
        """
        BATCH = 50
        cached = 0
        for i in range(0, len(advert_ids), BATCH):
            batch = advert_ids[i:i + BATCH]
            ids_param = ",".join(str(x) for x in batch)
            data = self._request("GET", "/api/advert/v2/adverts", params={"ids": ids_param})
            if not data:
                continue
            adverts = data.get("adverts", []) if isinstance(data, dict) else data
            for ad in adverts:
                aid = ad.get("id") if isinstance(ad, dict) else None
                if aid:
                    self._adverts_cache[aid] = ad
                    cached += 1
        return cached

    def get_campaign_info(self, advert_id: int) -> Optional[dict]:
        """Получить детали кампании. Сначала из кэша (заполняется prefetch_adverts),
        иначе — одиночный запрос как fallback (старое поведение)."""
        if advert_id in self._adverts_cache:
            return self._adverts_cache[advert_id]

        data = self._request("GET", "/api/advert/v2/adverts", params={"ids": advert_id})
        if not data:
            return None
        adverts = data.get("adverts", []) if isinstance(data, dict) else data
        if adverts:
            self._adverts_cache[advert_id] = adverts[0]
            return adverts[0]
        return data if isinstance(data, dict) else None

    # Окно статистики — максимум, который принимает WB (31 день).
    STATS_WINDOW_DAYS = 29  # WB реально принимает максимум 30 дней; ставим 29 на запас (31 → 400 "date range must not exceed 30 days")

    @staticmethod
    def _aggregate_clusters(daily_stats: list) -> list[Cluster]:
        """Из dailyStats[i].stat (одиночный объект на каждый день+кластер)
        агрегирует по normQuery суммируя views/clicks/atbs/orders/spend.

        Внимание: WB возвращает поле `stat` (singular), а не `stats` (массив).
        Каждый кластер за каждый день — отдельный элемент массива dailyStats."""
        agg: dict[str, dict] = {}
        for daily in (daily_stats or []):
            if not isinstance(daily, dict):
                continue
            stat = daily.get("stat")
            if not isinstance(stat, dict):
                continue
            nq = stat.get("normQuery") or ""
            if not nq:
                continue
            a = agg.setdefault(nq, {"views": 0, "clicks": 0, "atbs": 0,
                                    "orders": 0, "spend": 0.0})
            a["views"] += stat.get("views") or 0
            a["clicks"] += stat.get("clicks") or 0
            a["atbs"] += stat.get("atbs") or 0
            a["orders"] += stat.get("orders") or 0
            a["spend"] += stat.get("spend") or 0.0

        clusters = []
        for nq, s in agg.items():
            ctr = (s["clicks"] / s["views"] * 100) if s["views"] > 0 else 0.0
            clusters.append(Cluster(
                norm_query=nq,
                views=s["views"],
                clicks=s["clicks"],
                ctr=round(ctr, 2),
                carts=s["atbs"],
                orders=s["orders"],
                sum_price=s["spend"],
            ))
        return clusters

    def prefetch_cluster_stats(self, pairs: list) -> int:
        """Получить статистику кластеров пакетно для нескольких (advertId, nmId).

        WB лимитирует /adv/v1/normquery/stats до 1 запроса в час на seller,
        зато принимает массив items[] из множества пар. Один батч — одна квота.
        Без этого у БИА из 10 кампаний с "+" обработалась бы только первая.

        pairs: list[tuple[int advert_id, int nm_id]]. Складываем в _cluster_cache.
        """
        if not pairs:
            return 0
        BATCH = 50  # эмпирически — WB обычно соглашается на ~50
        date_to = datetime.now().strftime("%Y-%m-%d")
        date_from = (datetime.now() - timedelta(days=self.STATS_WINDOW_DAYS)).strftime("%Y-%m-%d")
        cached = 0
        for i in range(0, len(pairs), BATCH):
            chunk = pairs[i:i + BATCH]
            payload = {
                "from": date_from,
                "to": date_to,
                "items": [{"advertId": a, "nmId": n} for a, n in chunk],
            }
            data = self._request("POST", "/adv/v1/normquery/stats", json=payload)
            if not data:
                continue
            items = data.get("items") if isinstance(data, dict) else None
            if not items:
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                aid = item.get("advertId")
                nm = item.get("nmId")
                if not aid or not nm:
                    continue
                self._cluster_cache[(aid, nm)] = self._aggregate_clusters(
                    item.get("dailyStats") or []
                )
                cached += 1
        return cached

    def get_cluster_stats(self, advert_id: int, nm_id: int) -> list[Cluster]:
        """Сначала кэш (заполняется prefetch_cluster_stats), иначе одиночный
        запрос как fallback (старое поведение, но с правильной схемой v1)."""
        key = (advert_id, nm_id)
        if key in self._cluster_cache:
            return self._cluster_cache[key]

        date_to = datetime.now().strftime("%Y-%m-%d")
        date_from = (datetime.now() - timedelta(days=self.STATS_WINDOW_DAYS)).strftime("%Y-%m-%d")
        payload = {
            "from": date_from,
            "to": date_to,
            "items": [{"advertId": advert_id, "nmId": nm_id}],
        }
        data = self._request("POST", "/adv/v1/normquery/stats", json=payload)
        if not data:
            return []
        items = data.get("items") if isinstance(data, dict) else None
        if not items:
            return []
        clusters = self._aggregate_clusters(items[0].get("dailyStats") or [])
        self._cluster_cache[key] = clusters
        return clusters

    def get_keyword_stats(self, advert_id: int) -> list[Cluster]:
        """Устарел. /adv/v1/normquery/stats требует пар (advertId, nmId) в items[],
        без nm_id запрос невозможен. Раньше дополнял get_cluster_stats для
        кластеров с малым числом показов — теперь get_cluster_stats сам выгребает
        всё через тот же v1-эндпоинт по конкретной паре.
        Оставлен как no-op чтобы не ломать вызывающий код в _process_nm."""
        return []

    def get_minus_clusters(self, advert_id: int, nm_id: int) -> set[str]:
        """POST /adv/v0/normquery/get-minus — получить уже заминусованные кластеры."""
        payload = {"advert_id": advert_id, "nm_id": nm_id}
        data = self._request("POST", "/adv/v0/normquery/get-minus", json=payload)
        if not data:
            return set()
        items = data.get("items", [])
        if not items:
            return set()
        # items может быть списком строк или списком объектов
        result = set()
        for item in items:
            if isinstance(item, str):
                result.add(item.lower())
            elif isinstance(item, dict):
                query = item.get("norm_query", item.get("keyword", ""))
                if query:
                    result.add(query.lower())
        return result

    def set_minus_clusters(self, advert_id: int, nm_id: int,
                           norm_queries: list[str]) -> bool:
        """POST /adv/v0/normquery/set-minus — добавить в минус-фразы."""
        if not norm_queries:
            return True
        payload = {
            "advert_id": advert_id,
            "nm_id": nm_id,
            "norm_queries": norm_queries,
        }
        result = self._request("POST", "/adv/v0/normquery/set-minus", json=payload)
        return result is not None

    def rename_campaign(self, advert_id: int, new_name: str) -> bool:
        """POST /adv/v0/rename — переименовать кампанию."""
        result = self._request("POST", "/adv/v0/rename", json={
            "advertId": advert_id,
            "name": new_name,
        })
        return result is not None


# ──────────────────────────────────────────────────────────
# Анализатор — формула SELYUTIN
# ──────────────────────────────────────────────────────────

class ClusterAnalyzer:
    """
    Двухпроходный анализ:
      Pass 1 — базовые правила по каждому кластеру
      Pass 2 — коррекция: защита топа в слабых кампаниях + гарантия минимума
    """

    def __init__(self, config: Config):
        self.cfg = config

    def analyze(self, clusters: list[Cluster]) -> tuple[list[Decision], bool, float]:
        """
        Анализирует все кластеры одного артикула в кампании.
        Возвращает: (decisions, is_weak_campaign, median_ctr)
        """
        if not clusters:
            return [], False, 0.0

        # ── Сначала вычисляем медиану CTR для динамического порога ──
        ctrs_with_data = [cl.ctr for cl in clusters if cl.views >= self.cfg.min_views]
        median_ctr = statistics.median(ctrs_with_data) if ctrs_with_data else 0.0
        is_weak = median_ctr < self.cfg.weak_campaign_ctr

        # ── Вычисляем динамический порог CTR ──
        if self.cfg.use_dynamic_ctr:
            # Динамический порог = max(min_dynamic_ctr, медиана * factor)
            # Но не выше заданного min_ctr
            dynamic_threshold = max(
                self.cfg.min_dynamic_ctr,
                median_ctr * self.cfg.dynamic_ctr_factor
            )
            effective_ctr_threshold = min(dynamic_threshold, self.cfg.min_ctr)
        else:
            effective_ctr_threshold = self.cfg.min_ctr

        # ── Pass 1: базовые правила ──
        decisions = []
        for cl in clusters:
            decision = self._evaluate_single(cl, effective_ctr_threshold)
            decisions.append(decision)

        # ── Pass 2: коррекция для слабых кампаний ──
        if is_weak:
            decisions = self._protect_top_clusters(clusters, decisions)

        # ── Pass 3: гарантия минимума ──
        decisions = self._guarantee_minimum(clusters, decisions)

        return decisions, is_weak, median_ctr

    def _evaluate_single(self, cl: Cluster, ctr_threshold: float = None) -> Decision:
        """Базовое правило для одного кластера.

        Args:
            cl: Кластер для анализа
            ctr_threshold: Порог CTR (если None, используется cfg.min_ctr)
        """
        if ctr_threshold is None:
            ctr_threshold = self.cfg.min_ctr

        # Запрещённые слова — удаляем безусловно
        if "dite" in cl.norm_query.lower():
            return Decision(cl, "exclude",
                            f"содержит запрещённое слово 'dite'",
                            "запрещённое слово")

        # Мало показов — не трогаем, ещё рано судить
        if cl.views < self.cfg.min_views:
            return Decision(cl, "keep", f"мало показов ({cl.views} < {self.cfg.min_views})", "недостаточно данных")

        # Есть заказы — безусловная защита (важнее корзин)
        if cl.orders >= 1:
            return Decision(cl, "keep",
                            f"CTR {cl.ctr:.1f}%, но есть {cl.orders} заказ(ов) → защита",
                            "защита заказом")

        # Есть корзины — защита
        if cl.carts >= self.cfg.min_carts_to_protect:
            return Decision(cl, "keep",
                            f"CTR {cl.ctr:.1f}%, но есть {cl.carts} корзин(а) → защита",
                            "защита корзиной")

        # CTR ниже порога и нет корзин — удалять
        if cl.ctr < ctr_threshold:
            return Decision(cl, "exclude",
                            f"CTR {cl.ctr:.1f}% < {ctr_threshold:.1f}%, корзин: {cl.carts}",
                            "низкий CTR без корзин")

        # Всё ок
        return Decision(cl, "keep", f"CTR {cl.ctr:.1f}% ≥ {ctr_threshold:.1f}%", "норма")

    def _protect_top_clusters(self, clusters: list[Cluster],
                              decisions: list[Decision]) -> list[Decision]:
        """
        Если кампания «слабая» — оставляем топ-20% кластеров по CTR,
        даже если они ниже порога.
        """
        indexed = list(enumerate(decisions))
        analyzable = [(i, d) for i, d in indexed if d.cluster.views >= self.cfg.min_views]

        if not analyzable:
            return decisions

        analyzable.sort(key=lambda x: x[1].cluster.ctr, reverse=True)

        keep_count = max(1, math.ceil(len(analyzable) * self.cfg.top_keep_pct))

        for rank, (i, d) in enumerate(analyzable[:keep_count]):
            if d.action == "exclude" and d.rule != "запрещённое слово":
                decisions[i] = Decision(
                    d.cluster, "keep",
                    f"CTR {d.cluster.ctr:.1f}% — топ-{rank+1} в слабой кампании (медиана CTR < {self.cfg.weak_campaign_ctr}%)",
                    "защита топа (слабая кампания)"
                )

        return decisions

    def _guarantee_minimum(self, clusters: list[Cluster],
                           decisions: list[Decision]) -> list[Decision]:
        """
        Гарантируем, что после чистки останется минимум N кластеров.
        Если все на удаление — оставляем лучшие.
        """
        keep_count = sum(1 for d in decisions if d.action == "keep")
        # Не спасаем кластеры с запрещёнными словами
        exclude_list = [(i, d) for i, d in enumerate(decisions)
                        if d.action == "exclude" and d.rule != "запрещённое слово"]

        deficit = self.cfg.min_clusters_alive - keep_count

        if deficit <= 0 or not exclude_list:
            return decisions

        exclude_list.sort(key=lambda x: x[1].cluster.ctr, reverse=True)

        for idx in range(min(deficit, len(exclude_list))):
            i, d = exclude_list[idx]
            decisions[i] = Decision(
                d.cluster, "keep",
                f"CTR {d.cluster.ctr:.1f}% — спасён от удаления (гарантия мин. {self.cfg.min_clusters_alive} кластеров)",
                "гарантия минимума"
            )

        return decisions


# ──────────────────────────────────────────────────────────
# Утилиты
# ──────────────────────────────────────────────────────────

# Паттерн для дат: ДД.ММ.ГГГГ или ДД.ММ (без года)
DATE_PATTERN_FULL = re.compile(r'\d{1,2}\.\d{2}\.\d{4}')  # 27.02.2026
DATE_PATTERN_SHORT = re.compile(r'\d{1,2}\.\d{2}(?!\.\d)')  # 27.02 (не перед .ГГГГ)


def update_date_in_name(name: str) -> str:
    """Заменяет дату в формате ДД.ММ.ГГГГ или ДД.ММ на текущую."""
    today = datetime.now(MSK).strftime("%d.%m.%Y")
    # Сначала пробуем полный формат
    if DATE_PATTERN_FULL.search(name):
        return DATE_PATTERN_FULL.sub(today, name)
    # Потом короткий формат (без года)
    if DATE_PATTERN_SHORT.search(name):
        return DATE_PATTERN_SHORT.sub(today, name)
    return name


# ──────────────────────────────────────────────────────────
# Оркестратор
# ──────────────────────────────────────────────────────────

class WBClusterOptimizer:

    def __init__(self, api: WBAdvertAPI, analyzer: ClusterAnalyzer, dry_run: bool = True):
        self.api = api
        self.analyzer = analyzer
        self.dry_run = dry_run
        self.reports: list[CampaignReport] = []
        self.minus_cache = MinusCache()

        # Показываем статистику кэша при запуске
        camps, total = self.minus_cache.get_stats()
        if total > 0:
            print(f"  Локальный кэш: {total} заминусованных кластеров в {camps} кампаниях")

    def run(self) -> list[CampaignReport]:
        self._print_header()

        campaigns = self.api.get_campaigns()  # Активные и приостановленные
        if not campaigns:
            logging.warning("Нет активных кампаний или ошибка API")
            return []

        logging.info(f"Найдено активных кампаний: {len(campaigns)}\n")

        # Пакетно подгружаем детали всех кампаний в кэш одним запросом на 50.
        # Без этого /api/advert/v2/adverts отдаёт 429 после первого id (лимит 1/час).
        all_ids = [c.get("advertId") or c.get("advert_id") or c.get("id") for c in campaigns]
        all_ids = [x for x in all_ids if x]
        if all_ids:
            cached = self.api.prefetch_adverts(all_ids)
            logging.info(f"Предзагружено деталей кампаний: {cached}/{len(all_ids)}")

        # Собираем (advertId, nmId) пары для всех кампаний с "+" в названии
        # и одним батч-запросом получаем статистику кластеров для всех сразу.
        # /adv/v1/normquery/stats — лимит 1 запрос/час, поэтому один батч на
        # весь аккаунт вместо N отдельных по каждой паре.
        stats_pairs = []
        for camp in campaigns:
            aid = camp.get("advertId") or camp.get("advert_id") or camp.get("id")
            if not aid:
                continue
            info = self.api._adverts_cache.get(aid)
            if not info:
                continue
            settings = info.get("settings", {}) if isinstance(info.get("settings"), dict) else {}
            name = settings.get("name") or info.get("name", "")
            if "+" not in (name or ""):
                continue
            for nm in self._extract_nm_ids(info):
                stats_pairs.append((aid, nm))
        if stats_pairs:
            cached_stats = self.api.prefetch_cluster_stats(stats_pairs)
            logging.info(f"Предзагружено статистики кластеров: {cached_stats}/{len(stats_pairs)} пар")

        for camp in campaigns:
            advert_id = camp.get("advertId", camp.get("advert_id", camp.get("id")))
            if not advert_id:
                continue
            report = self._process_campaign(advert_id, camp)
            self.reports.append(report)

        self._print_summary()
        self._save_report()
        return self.reports

    def _print_header(self):
        mode = "DRY RUN (без изменений)" if self.dry_run else "⚡ БОЕВОЙ РЕЖИМ"
        cfg = self.analyzer.cfg
        print()
        print("╔══════════════════════════════════════════════════════════╗")
        print("║          WB CLUSTER OPTIMIZER — SELYUTIN v2.0           ║")
        print("╚══════════════════════════════════════════════════════════╝")
        print(f"  Режим:            {mode}")
        print(f"  Дата:             {datetime.now(MSK).strftime('%Y-%m-%d %H:%M')}")
        print(f"  Формула:")
        print(f"    Мин. показов:   {cfg.min_views}")
        if cfg.use_dynamic_ctr:
            print(f"    CTR порог:      ДИНАМИЧЕСКИЙ")
            print(f"      - мин:        {cfg.min_dynamic_ctr}%")
            print(f"      - макс:       {cfg.min_ctr}%")
            print(f"      - фактор:     медиана × {cfg.dynamic_ctr_factor}")
        else:
            print(f"    Мин. CTR:       {cfg.min_ctr}%")
        print(f"    Слабая РК:      медиана < {cfg.weak_campaign_ctr}%")
        print(f"    Защита корзин:  ≥{cfg.min_carts_to_protect}")
        print(f"    Защита заказов: ≥1")
        print(f"    Топ слабой РК:  {int(cfg.top_keep_pct * 100)}%")
        print(f"    Мин. кластеров: {cfg.min_clusters_alive}")
        print()

    def _process_campaign(self, advert_id: int, camp_data: dict) -> CampaignReport:
        report = CampaignReport(advert_id=advert_id)

        # Получаем полную информацию о кампании через API
        info = self.api.get_campaign_info(advert_id)
        if info:
            camp_data = info  # Используем свежие данные из API

        # Получаем название кампании (новый формат: settings.name)
        settings = camp_data.get("settings", {})
        old_name = settings.get("name", "") if isinstance(settings, dict) else ""
        if not old_name:
            old_name = camp_data.get("name", camp_data.get("title", ""))

        report.old_name = old_name

        print(f"{'─' * 58}")
        print(f"  Кампания #{advert_id}")

        # Фильтр: чистим только кампании с "+" в названии
        if "+" not in old_name:
            print(f"    Название: {old_name}")
            print(f"    ⏭ Пропущена (нет '+' в названии)")
            return report

        print(f"    Название: {old_name}")

        nm_ids = self._extract_nm_ids(camp_data)
        if not nm_ids:
            info = self.api.get_campaign_info(advert_id)
            if info:
                nm_ids = self._extract_nm_ids(info)
                if not old_name:
                    info_settings = info.get("settings", {})
                    old_name = info_settings.get("name", "") if isinstance(info_settings, dict) else ""
                    if not old_name:
                        old_name = info.get("name", info.get("title", ""))
                    report.old_name = old_name

        if not nm_ids:
            print(f"    ⚠ Не удалось определить артикулы")
            report.errors.append("Нет nm_id")
            return report

        report.nm_ids = nm_ids
        print(f"    Артикулы: {nm_ids}")

        for nm_id in nm_ids:
            self._process_nm(advert_id, nm_id, report)

        # Обновляем дату в названии кампании
        if old_name and (DATE_PATTERN_FULL.search(old_name) or DATE_PATTERN_SHORT.search(old_name)):
            new_name = update_date_in_name(old_name)

            if old_name != new_name:
                if self.dry_run:
                    print(f"    [DRY RUN] Название: {old_name} → {new_name}")
                    report.new_name = new_name  # для статистики dry-run
                else:
                    # report.new_name ставим ТОЛЬКО при подтверждённом успехе,
                    # иначе счётчик renamed_campaigns включает упавшие попытки.
                    if self.api.rename_campaign(advert_id, new_name):
                        print(f"    Переименовано: {old_name} → {new_name}")
                        report.new_name = new_name
                    else:
                        print(f"    ✗ Ошибка переименования")
                        report.errors.append("Ошибка переименования")

        return report

    def _process_nm(self, advert_id: int, nm_id: int, report: CampaignReport):
        # Получаем локальный кэш заминусованных кластеров (для объединения с новыми)
        cached_excluded = self.minus_cache.get_excluded(advert_id, nm_id)
        cached_lower = {q.lower() for q in cached_excluded} if cached_excluded else set()

        # Получаем статистику кластеров (≥100 показов)
        clusters = self.api.get_cluster_stats(advert_id, nm_id)

        # Дополняем старым методом для кластеров с 40–99 показами
        old_clusters = self.api.get_keyword_stats(advert_id)
        if old_clusters:
            existing_queries = {c.norm_query for c in clusters}
            for oc in old_clusters:
                if oc.norm_query and oc.norm_query not in existing_queries:
                    clusters.append(oc)

        # ── Фильтр: уже-минусованные фразы НЕ идут в анализ. ──
        # WB API возвращает их статистику из 29-дневного окна (преимущественно
        # доминусационную), и этот «застывший» CTR конкурирует в Pass 2 / Pass 3
        # с живыми фразами. Без фильтра у нас был эффект «спасение Pass 2 живёт
        # один прогон»: на следующий день лидер по CTR сдвигался, и ранее
        # спасённая фраза по union'у уходила в минусы. Кэш всё равно склеивается
        # с новыми exclude'ами при отправке — минусованные останутся минусованными,
        # просто не «занимают слоты» в Pass 2/3.
        if cached_lower:
            before = len(clusters)
            clusters = [c for c in clusters if c.norm_query.lower() not in cached_lower]
            skipped = before - len(clusters)
            if skipped:
                print(f"    nm {nm_id}: пропущено уже-минусованных в анализе: {skipped}")

        if not clusters:
            # Кэш уже на стороне WB — повторно слать set-minus не нужно.
            # Раньше тут была повторная отправка, она бесполезно жгла квоту
            # /adv/v0/normquery/set-minus и в итоге не оставалось лимита на rename.
            if cached_excluded:
                print(f"    nm {nm_id}: нет новых кластеров (в кэше {len(cached_excluded)} уже на WB)")
            else:
                print(f"    nm {nm_id}: нет активных кластеров")
            return

        # ── Анализ ──
        decisions, is_weak, median_ctr = self.analyzer.analyze(clusters)
        report.is_weak = is_weak
        report.median_ctr = median_ctr
        report.decisions.extend(decisions)

        excludes = [d for d in decisions if d.action == "exclude"]
        keeps = [d for d in decisions if d.action == "keep"]

        weak_tag = " ⚠ СЛАБАЯ" if is_weak else ""
        print(f"    nm {nm_id}: {len(clusters)} кластеров, "
              f"медиана CTR: {median_ctr:.1f}%{weak_tag}")
        print(f"      Оставить: {len(keeps)} | Удалить: {len(excludes)}")

        for d in decisions:
            icon = "✗" if d.action == "exclude" else "✓"
            rule_tag = f"[{d.rule}]" if d.rule != "норма" else ""
            print(f"      {icon} «{d.cluster.norm_query}» — "
                  f"показы: {d.cluster.views}, CTR: {d.cluster.ctr:.1f}%, "
                  f"корзины: {d.cluster.carts} "
                  f"{rule_tag}")

        # ── Исполнение ──
        # Собираем новые кластеры для удаления
        new_queries = [d.cluster.norm_query for d in excludes]

        # Объединяем: кэш + новые (без дубликатов, всё в lowercase)
        # cached_lower уже посчитан в начале функции — используем его.
        all_minus_lower = set(cached_lower)
        all_minus_lower.update(q.lower() for q in new_queries)
        all_minus_list = list(all_minus_lower)

        # Считаем только действительно новые (которых НЕ было в кэше)
        # Используем set для исключения дубликатов с разным регистром
        truly_new_lower = set()
        truly_new_count = 0
        for q in new_queries:
            q_lower = q.lower()
            if q_lower not in cached_lower and q_lower not in truly_new_lower:
                truly_new_count += 1
                truly_new_lower.add(q_lower)

        # Обновляем статистику в отчёте
        cache_count = len(cached_excluded) if cached_excluded else 0
        report.from_cache += cache_count
        report.new_excluded += truly_new_count  # только действительно новые (без дублей)
        report.total_minus += len(all_minus_list)

        if all_minus_list:
            if self.dry_run:
                print(f"      [DRY RUN] Было бы в минус-фразах: {len(all_minus_list)} "
                      f"(новых: {truly_new_count}, из кэша: {cache_count})")
            else:
                self._send_minus_batch(advert_id, nm_id, all_minus_list, report)

    def _send_minus_batch(self, advert_id: int, nm_id: int, queries: list, report: CampaignReport):
        """Отправляет минус-фразы одним запросом, убирая невалидные при ошибках."""
        import re
        remaining = list(queries)
        invalid = []

        while remaining:
            ok = self.api.set_minus_clusters(advert_id, nm_id, remaining)
            if ok:
                # Успешно - сохраняем в кэш
                self.minus_cache.add_excluded(advert_id, nm_id, remaining)
                print(f"      Заминусовано: {len(remaining)} кластеров")
                if invalid:
                    print(f"      Невалидных: {len(invalid)}")
                return

            # Ошибка - пробуем найти невалидный кластер
            # API возвращает: "norm_query 'xxx' is not valid for nm yyy"
            # Нужно получить текст ошибки из последнего запроса
            # Делаем повторный запрос чтобы получить ошибку
            import requests
            resp = requests.post(
                f"https://advert-api.wildberries.ru/adv/v0/normquery/set-minus",
                headers=self.api.session.headers,
                json={"advert_id": advert_id, "nm_id": nm_id, "norm_queries": remaining}
            )

            if resp.status_code == 200:
                self.minus_cache.add_excluded(advert_id, nm_id, remaining)
                print(f"      Заминусовано: {len(remaining)} кластеров")
                return

            match = re.search(r"norm_query '([^']+)' is not valid", resp.text)
            if match:
                bad_query = match.group(1)
                invalid.append(bad_query)
                remaining = [q for q in remaining if q != bad_query]
            else:
                # Не смогли распарсить ошибку
                report.errors.append(f"Ошибка минусации nm {nm_id}: {resp.text[:100]}")
                print(f"      ✗ Ошибка: {resp.text[:100]}")
                return

        # Все кластеры оказались невалидными
        if invalid:
            print(f"      Все {len(invalid)} кластеров невалидны")

    def _extract_nm_ids(self, data: dict) -> list[int]:
        """Извлекает nm_ids из различных форматов ответа API."""
        nm_ids = []

        # Формат 0: nm_settings[].nm_id (актуальный формат 2026)
        for setting in data.get("nm_settings", []):
            if "nm_id" in setting:
                nm_ids.append(setting["nm_id"])

        # Формат 1: params[].nms (старый формат)
        for param in data.get("params", []):
            nm_ids.extend(param.get("nms", []))

        # Формат 2: unitedParams[].nms или united_params[].nms
        for param in data.get("unitedParams", data.get("united_params", [])):
            nm_ids.extend(param.get("nms", []))

        # Формат 3: autoParams[].nms (автоматические кампании)
        for param in data.get("autoParams", data.get("auto_params", [])):
            nm_ids.extend(param.get("nms", []))

        # Формат 4: searchParams[].nms (поисковые кампании)
        for param in data.get("searchParams", data.get("search_params", [])):
            nm_ids.extend(param.get("nms", []))

        # Формат 5: nmIds напрямую
        if not nm_ids:
            nm_ids = data.get("nmIds", data.get("nm_ids", []))

        # Формат 6: nms напрямую
        if not nm_ids:
            nm_ids = data.get("nms", [])

        # Формат 7: единичный nm_id
        if not nm_ids and "nm_id" in data:
            nm_ids = [data["nm_id"]]
        if not nm_ids and "nmId" in data:
            nm_ids = [data["nmId"]]

        return list(set(nm_ids))

    def _print_summary(self):
        total_clusters = 0
        total_excluded = 0
        total_kept = 0
        total_errors = 0
        weak_campaigns = 0

        for r in self.reports:
            total_excluded += len(r.to_exclude)
            total_kept += len(r.to_keep)
            total_clusters += len(r.decisions)
            total_errors += len(r.errors)
            if r.is_weak:
                weak_campaigns += 1

        print()
        print("╔══════════════════════════════════════════════════════════╗")
        print("║                    ИТОГОВЫЙ ОТЧЁТ                       ║")
        print("╠══════════════════════════════════════════════════════════╣")
        print(f"║  Кампаний обработано:   {len(self.reports):>4}                            ║")
        print(f"║  Из них «слабых»:       {weak_campaigns:>4}                            ║")
        print(f"║  Всего кластеров:       {total_clusters:>4}                            ║")
        print(f"║  К удалению:            {total_excluded:>4}                            ║")
        print(f"║  Оставлено:             {total_kept:>4}                            ║")
        if total_errors:
            print(f"║  Ошибки:                {total_errors:>4}                            ║")
        print(f"║                                                          ║")
        if self.dry_run:
            print(f"║  Режим:              DRY RUN                             ║")
        else:
            print(f"║  Режим:              БОЕВОЙ                              ║")
        print("╚══════════════════════════════════════════════════════════╝")

        rules_counter = {}
        for r in self.reports:
            for d in r.decisions:
                key = f"{d.action}:{d.rule}"
                rules_counter[key] = rules_counter.get(key, 0) + 1

        if rules_counter:
            print("\n  Статистика по правилам:")
            for key, count in sorted(rules_counter.items(), key=lambda x: -x[1]):
                action, rule = key.split(":", 1)
                icon = "✗" if action == "exclude" else "✓"
                print(f"    {icon} {rule}: {count}")

    def _save_report(self):
        report_data = {
            "timestamp": datetime.now(MSK).isoformat(),
            "dry_run": self.dry_run,
            "config": {
                "min_views": self.analyzer.cfg.min_views,
                "min_ctr": self.analyzer.cfg.min_ctr,
                "min_carts_to_protect": self.analyzer.cfg.min_carts_to_protect,
                "top_keep_pct": self.analyzer.cfg.top_keep_pct,
                "min_clusters_alive": self.analyzer.cfg.min_clusters_alive,
            },
            "campaigns": [
                {
                    "advert_id": r.advert_id,
                    "old_name": r.old_name,
                    "new_name": r.new_name,
                    "nm_ids": r.nm_ids,
                    "is_weak": r.is_weak,
                    "median_ctr": round(r.median_ctr, 2),
                    "total_minus": r.total_minus,
                    "new_excluded": r.new_excluded,
                    "from_cache": r.from_cache,
                    "excluded": [
                        {
                            "query": d.cluster.norm_query,
                            "views": d.cluster.views,
                            "ctr": round(d.cluster.ctr, 2),
                            "carts": d.cluster.carts,
                            "reason": d.reason,
                            "rule": d.rule,
                        }
                        for d in r.to_exclude
                    ],
                    "kept": [
                        {
                            "query": d.cluster.norm_query,
                            "views": d.cluster.views,
                            "ctr": round(d.cluster.ctr, 2),
                            "carts": d.cluster.carts,
                            "rule": d.rule,
                        }
                        for d in r.to_keep
                    ],
                    "errors": r.errors,
                }
                for r in self.reports
            ],
        }

        path = f"wb_optimizer_report_{datetime.now(MSK).strftime('%Y%m%d_%H%M%S')}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
        print(f"\n  Отчёт: {path}")


# ──────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="WB Cluster Optimizer — чистка неэффективных кластеров по формуле SELYUTIN"
    )
    parser.add_argument("--token", default=os.environ.get("tokenbia"),
                        help="API-токен WB (или укажите tokenbia в .env)")
    parser.add_argument("--dry-run", action="store_true", default=False,
                        help="Только показать решения, без реальных изменений")
    parser.add_argument("--min-views", type=int, default=40,
                        help="Минимум показов для анализа (по умолчанию 40)")
    parser.add_argument("--min-ctr", type=float, default=4.0,
                        help="Порог CTR в %% (по умолчанию 4.0)")
    parser.add_argument("--min-carts", type=int, default=1,
                        help="Сколько корзин защищают кластер (по умолчанию 1)")
    parser.add_argument("--top-keep-pct", type=float, default=20,
                        help="Процент топ-кластеров для слабых кампаний (по умолчанию 20)")
    parser.add_argument("--min-alive", type=int, default=3,
                        help="Минимум кластеров, которые останутся в кампании (по умолчанию 3)")
    parser.add_argument("--no-dynamic-ctr", action="store_true",
                        help="Отключить динамический порог CTR (использовать фиксированный)")
    parser.add_argument("--min-dynamic-ctr", type=float, default=2.0,
                        help="Минимальный порог CTR при динамическом расчёте (по умолчанию 2.0)")
    parser.add_argument("--dynamic-factor", type=float, default=0.7,
                        help="Множитель медианы для динамического порога (по умолчанию 0.7)")
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args()

    if not args.token:
        print("Ошибка: токен не указан!")
        print("Укажите токен через --token или добавьте tokenbia в .env файл")
        sys.exit(1)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    config = Config(
        min_views=args.min_views,
        min_ctr=args.min_ctr,
        min_carts_to_protect=args.min_carts,
        top_keep_pct=args.top_keep_pct / 100,
        min_clusters_alive=args.min_alive,
        use_dynamic_ctr=not args.no_dynamic_ctr,
        min_dynamic_ctr=args.min_dynamic_ctr,
        dynamic_ctr_factor=args.dynamic_factor,
    )

    api = WBAdvertAPI(token=args.token)
    analyzer = ClusterAnalyzer(config)
    optimizer = WBClusterOptimizer(api, analyzer, dry_run=args.dry_run)

    try:
        optimizer.run()
    except KeyboardInterrupt:
        print("\nПрервано")
        sys.exit(1)


if __name__ == "__main__":
    main()
