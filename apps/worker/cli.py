"""CLI точка входа для воркера. Заменяет старый multi_account_cleaner.py.

Использование:
  python -m apps.worker.cli                      # все активные аккаунты
  python -m apps.worker.cli --account-id <uuid>  # только один
"""
from __future__ import annotations

import argparse
import logging
import sys

import psycopg
from psycopg.rows import dict_row

from wb_cleaner_core import db
from wb_cleaner_core.runner import run_one_account, run_all_active_accounts


def setup_logging(verbose: bool) -> None:
    # Сообщения через стандартный logging. Маскирование токенов делается
    # в самих модулях (crypto.mask_token); сам токен ни в логи, ни в
    # repr ActiveAccount не пишется.
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WB Cleaner worker")
    parser.add_argument(
        "--account-id",
        help="UUID одного аккаунта. Если не задан — все активные.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)

    # row_factory=dict_row обязателен — db.load_active_accounts читает row["..."]
    with psycopg.connect(db.get_database_url(), row_factory=dict_row) as conn:
        if args.account_id:
            accounts = [
                a for a in db.load_active_accounts(conn) if a.id == args.account_id
            ]
            if not accounts:
                print(f"Аккаунт {args.account_id} не найден или не активен", file=sys.stderr)
                return 1
            results = [run_one_account(conn, accounts[0], run_mode=accounts[0].mode)]
        else:
            results = run_all_active_accounts(conn)

    for r in results:
        prev = " [preview]" if r.skipped_preview else ""
        print(
            f"{r.status:>10}  {r.account_id}{prev}  "
            f"decisions=exclude:{r.decisions_exclude}/keep:{r.decisions_keep}  "
            f"applied={r.applied}  time={r.processing_time_sec:.1f}s"
        )
        if r.error:
            print(f"             error: {r.error}", file=sys.stderr)

    failed = sum(1 for r in results if r.status == "failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
