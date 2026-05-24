"""Разовая миграция старого config.json + minus_cache.json в БД.

Использование:
  python scripts/migrate_legacy_config.py \\
      --owner-email me@example.com \\
      --config-path /path/to/old/config.json \\
      --cache-path  /path/to/old/minus_cache.json \\
      [--cache-account-name "Магазин 1"]

- Юзер по --owner-email находится или создаётся.
- Аккаунты из config.json идут в `wb_accounts` с mode='auto' (это прод,
  preview-таймер уже неактуален).
- Идемпотентность: аккаунт по (user_id, name) пропускается если уже есть.
- minus_cache.json: старый формат {advert_id: {nm_id: [phrases]}} лит в
  таблицу minus_cache. Account_id берётся:
    * если --cache-account-name указан — только в этот аккаунт;
    * иначе — во ВСЕ аккаунты юзера (с ON CONFLICT DO NOTHING).
  Лишние пары для «чужих» кампаний не страшны: воркер проверяет
  get_excluded по своим кампаниям, и неиспользуемые записи просто лежат.

ВАЖНО: токены в config.json — РЕАЛЬНЫЕ. Скрипт никогда не пишет
их в stdout/log/etc, кроме маски через crypto.mask_token().
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Iterable

import psycopg
from dotenv import load_dotenv

# Тестируется через subprocess, поэтому подмешиваем PYTHONPATH-сейв импорт.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from wb_cleaner_core import crypto, db  # noqa: E402

ROOT_ENV = ROOT.parent.parent / ".env"
load_dotenv(ROOT_ENV, override=False)


log = logging.getLogger("migrate")


def get_or_create_user(conn: psycopg.Connection, email: str) -> str:
    """Найти юзера по email или создать нового."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id FROM users WHERE lower(email) = lower(%s)",
            (email,),
        )
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute(
            "INSERT INTO users (email) VALUES (%s) RETURNING id::text",
            (email,),
        )
        new_row = cur.fetchone()
        if not new_row:
            raise RuntimeError("INSERT users did not return id")
        return new_row[0]


def get_default_preset_id(conn: psycopg.Connection) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id FROM rules_profiles "
            "WHERE is_preset = true AND name = 'Одежда' LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(
                "Не найден дефолтный пресет «Одежда». "
                "Запусти `pnpm db:seed` сначала."
            )
        return row[0]


def import_accounts(
    conn: psycopg.Connection,
    user_id: str,
    accounts_cfg: list[dict],
    preset_id: str,
) -> dict[str, str]:
    """Импортирует аккаунты с mode='auto'. Возвращает {name: account_id}
    для всех аккаунтов юзера (включая уже существовавшие)."""
    name_to_id: dict[str, str] = {}

    for acc_cfg in accounts_cfg:
        name = acc_cfg["name"]
        token = acc_cfg["token"]

        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text AS id FROM wb_accounts "
                "WHERE user_id = %s AND name = %s",
                (user_id, name),
            )
            existing = cur.fetchone()
            if existing:
                log.info(
                    "skip account %r — уже есть (id=%s, token=%s)",
                    name,
                    existing[0],
                    crypto.mask_token(token),
                )
                name_to_id[name] = existing[0]
                continue

            enc = crypto.encrypt_token(token)
            cur.execute(
                """
                INSERT INTO wb_accounts
                  (user_id, name, encrypted_token, token_iv, token_tag,
                   mode, last_validated_at)
                VALUES (%s, %s, %s, %s, %s, 'auto', NULL)
                RETURNING id::text
                """,
                (user_id, name, enc.ciphertext, enc.iv, enc.tag),
            )
            new_row = cur.fetchone()
            if not new_row:
                raise RuntimeError("INSERT wb_accounts did not return id")
            new_id = new_row[0]
            cur.execute(
                "INSERT INTO wb_account_rules (wb_account_id, rules_profile_id) "
                "VALUES (%s, %s)",
                (new_id, preset_id),
            )
            log.info(
                "imported account %r (id=%s, token=%s)",
                name,
                new_id,
                crypto.mask_token(token),
            )
            name_to_id[name] = new_id

    return name_to_id


def flatten_minus_cache(cache_data: dict) -> Iterable[tuple[int, int, str]]:
    """Старый формат {advert_id: {nm_id: [phrases]}} → плоский генератор."""
    for advert_id_str, by_nm in cache_data.items():
        try:
            advert_id = int(advert_id_str)
        except (TypeError, ValueError):
            continue
        if not isinstance(by_nm, dict):
            continue
        for nm_id_str, phrases in by_nm.items():
            try:
                nm_id = int(nm_id_str)
            except (TypeError, ValueError):
                continue
            if not isinstance(phrases, list):
                continue
            for p in phrases:
                if isinstance(p, str) and p:
                    yield advert_id, nm_id, p


def import_minus_cache(
    conn: psycopg.Connection,
    cache_path: Path,
    target_accounts: list[str],
) -> int:
    if not cache_path.exists():
        log.warning("Файл minus_cache.json не найден: %s — пропускаем", cache_path)
        return 0
    data = json.loads(cache_path.read_text(encoding="utf-8"))
    entries = list(flatten_minus_cache(data))
    if not entries:
        log.warning("minus_cache.json пуст — нечего лить")
        return 0

    total_inserted = 0
    for account_id in target_accounts:
        inserted = db.upsert_minus_cache(conn, account_id, entries)
        log.info("account_id=%s: вставлено новых строк = %d", account_id, inserted)
        total_inserted += inserted
    return total_inserted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Импорт legacy config.json + minus_cache.json в БД")
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--config-path", required=True, type=Path)
    parser.add_argument("--cache-path", type=Path, default=None)
    parser.add_argument(
        "--cache-account-name",
        help="Если задан — minus_cache лит ТОЛЬКО в этот аккаунт по имени; "
        "иначе во все аккаунты юзера.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    if not args.config_path.exists():
        print(f"config.json не найден: {args.config_path}", file=sys.stderr)
        return 2
    cfg = json.loads(args.config_path.read_text(encoding="utf-8"))
    accounts_cfg = cfg.get("accounts") or []
    if not accounts_cfg:
        print("В config.json нет ключа 'accounts'", file=sys.stderr)
        return 2

    with psycopg.connect(db.get_database_url()) as conn:
        user_id = get_or_create_user(conn, args.owner_email)
        preset_id = get_default_preset_id(conn)
        name_to_id = import_accounts(conn, user_id, accounts_cfg, preset_id)

        if args.cache_path:
            if args.cache_account_name:
                acc_id = name_to_id.get(args.cache_account_name)
                if not acc_id:
                    print(
                        f"--cache-account-name={args.cache_account_name!r} "
                        "не найден среди импортированных аккаунтов",
                        file=sys.stderr,
                    )
                    return 2
                targets = [acc_id]
            else:
                targets = list(name_to_id.values())
            import_minus_cache(conn, args.cache_path, targets)

        conn.commit()

    print("Готово.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
