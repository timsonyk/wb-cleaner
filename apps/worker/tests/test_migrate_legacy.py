"""Integration тест для migrate_legacy_config.py.
Имитирует config.json и minus_cache.json во временной директории."""
from __future__ import annotations

import base64
import json
import os
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from dotenv import load_dotenv

from wb_cleaner_core import crypto, db

# Подмешиваем scripts/ в импорт.
HERE = Path(__file__).resolve().parent
WORKER_ROOT = HERE.parent
sys.path.insert(0, str(WORKER_ROOT / "scripts"))

import migrate_legacy_config as migrate  # noqa: E402

load_dotenv(WORKER_ROOT.parent.parent / ".env", override=False)


def _pg_available() -> bool:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return False
    try:
        with psycopg.connect(url, connect_timeout=2) as c:
            c.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _pg_available(), reason="Postgres недоступен")


def _ensure_key():
    if not os.environ.get(crypto.ENV_VAR):
        os.environ[crypto.ENV_VAR] = base64.b64encode(os.urandom(32)).decode("ascii")
        crypto._reset_key_cache()


def test_migrate_creates_user_and_accounts(tmp_path):
    _ensure_key()
    email = f"migrate-test-{uuid.uuid4()}@x.local"

    config = {
        "accounts": [
            {"name": "M1", "token": "jwt-a.payload.sig"},
            {"name": "M2", "token": "jwt-b.payload.sig"},
        ],
    }
    cache = {
        "100": {"200": ["розовый", "детский"]},
        "101": {"300": ["слон"]},
    }
    cfg_path = tmp_path / "config.json"
    cache_path = tmp_path / "minus_cache.json"
    cfg_path.write_text(json.dumps(config), encoding="utf-8")
    cache_path.write_text(json.dumps(cache), encoding="utf-8")

    rc = migrate.main(
        [
            "--owner-email",
            email,
            "--config-path",
            str(cfg_path),
            "--cache-path",
            str(cache_path),
            "--cache-account-name",
            "M1",
        ],
    )
    assert rc == 0

    with psycopg.connect(db.get_database_url()) as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT id::text AS id FROM users WHERE lower(email)=lower(%s)",
                (email,),
            )
            user = cur.fetchone()
            assert user is not None
            uid = user["id"]

            cur.execute(
                "SELECT name, mode FROM wb_accounts WHERE user_id=%s ORDER BY name",
                (uid,),
            )
            accs = cur.fetchall()
            assert [a["name"] for a in accs] == ["M1", "M2"]
            assert all(a["mode"] == "auto" for a in accs)

            # У каждого должен быть привязанный пресет
            cur.execute(
                """
                SELECT a.name, p.name AS preset
                FROM wb_accounts a
                JOIN wb_account_rules ar ON ar.wb_account_id = a.id
                JOIN rules_profiles p ON p.id = ar.rules_profile_id
                WHERE a.user_id = %s
                ORDER BY a.name
                """,
                (uid,),
            )
            preset_rows = cur.fetchall()
            assert all(r["preset"] == "Одежда" for r in preset_rows)

            # minus_cache: 3 фразы попали в M1 (две из advert 100 + одна из 101)
            cur.execute(
                """
                SELECT a.name AS name, count(*) AS c
                FROM minus_cache mc
                JOIN wb_accounts a ON a.id = mc.wb_account_id
                WHERE a.user_id = %s
                GROUP BY a.name
                """,
                (uid,),
            )
            cache_counts = {r["name"]: r["c"] for r in cur.fetchall()}
            assert cache_counts.get("M1") == 3
            # M2 не получил минусы (т.к. --cache-account-name=M1)
            assert "M2" not in cache_counts

    # Cleanup: cascade на users удалит accounts/rules/cache.
    with psycopg.connect(db.get_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE lower(email)=lower(%s)", (email,))
        conn.commit()


def test_migrate_idempotent(tmp_path):
    _ensure_key()
    email = f"migrate-idem-{uuid.uuid4()}@x.local"

    config = {"accounts": [{"name": "A1", "token": "tok-1"}]}
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(config), encoding="utf-8")

    rc1 = migrate.main(
        ["--owner-email", email, "--config-path", str(cfg_path)],
    )
    rc2 = migrate.main(
        ["--owner-email", email, "--config-path", str(cfg_path)],
    )
    assert rc1 == 0
    assert rc2 == 0

    with psycopg.connect(db.get_database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM wb_accounts a "
                "JOIN users u ON u.id=a.user_id WHERE lower(u.email)=lower(%s)",
                (email,),
            )
            (count,) = cur.fetchone()
            assert count == 1  # не задублировался

            cur.execute("DELETE FROM users WHERE lower(email)=lower(%s)", (email,))
        conn.commit()
