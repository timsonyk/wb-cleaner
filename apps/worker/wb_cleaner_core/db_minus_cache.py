"""DB-обёртка вокруг старого `MinusCache` из wb_cluster_optimizer.py.
Имеет тот же поверхностный интерфейс — `get_excluded`, `add_excluded`,
`get_stats` — но хранит данные в Postgres вместо minus_cache.json.

Подсаживается в WBClusterOptimizer.minus_cache после конструктора.

Чтобы не делать SELECT при каждом get_excluded (1×N кластеров × N кампаний =
много round-trips), один раз грузим snapshot в память на конструктор.
add_excluded дописывает и в snapshot, и в БД (upsert).
"""
from __future__ import annotations

import psycopg

from . import db


class DBMinusCache:
    def __init__(self, conn: psycopg.Connection, account_id: str):
        self._conn = conn
        self._account_id = account_id
        # Загружаем весь снапшот разом, по (advert_id, nm_id) → set[phrase_lower].
        # WB phrases уже lower'нуты в get_minus_cache.
        self._snap: dict[tuple[int, int], set[str]] = {}
        for advert_id, nm_id, phrase in db.get_minus_cache(conn, account_id):
            self._snap.setdefault((advert_id, nm_id), set()).add(phrase)

    # ── Интерфейс, как у старого MinusCache ──

    def get_excluded(self, advert_id: int, nm_id: int) -> set[str]:
        return set(self._snap.get((advert_id, nm_id), set()))

    def add_excluded(self, advert_id: int, nm_id: int, queries: list[str]) -> None:
        if not queries:
            return
        bucket = self._snap.setdefault((advert_id, nm_id), set())
        new_entries: list[tuple[int, int, str]] = []
        for q in queries:
            ql = q.lower()
            if ql not in bucket:
                bucket.add(ql)
                # В БД пишем оригинальный регистр (для отображения), но lower
                # сравнение делается в БД через `lower(phrase)` в get_minus_cache.
                new_entries.append((advert_id, nm_id, q))
        if new_entries:
            db.upsert_minus_cache(self._conn, self._account_id, new_entries)

    def get_stats(self) -> tuple[int, int]:
        adverts = len({a for (a, _nm) in self._snap.keys()})
        total = sum(len(s) for s in self._snap.values())
        return adverts, total
