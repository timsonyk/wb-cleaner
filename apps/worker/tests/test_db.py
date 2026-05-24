"""Интеграционные тесты db.py против реального Postgres из docker-compose.
Если БД недоступна — тесты skip."""
from __future__ import annotations

import base64
import os
import uuid
from contextlib import contextmanager

import psycopg
import pytest
from dotenv import load_dotenv

from wb_cleaner_core import crypto, db


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_ENV = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".env"))
load_dotenv(ROOT_ENV, override=False)


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


@pytest.fixture
def conn():
    """Открываем соединение, в конце теста rollback'аем всё, что натворили."""
    c = psycopg.connect(db.get_database_url(), row_factory=psycopg.rows.dict_row)
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def _ensure_key():
    if not os.environ.get(crypto.ENV_VAR):
        os.environ[crypto.ENV_VAR] = base64.b64encode(os.urandom(32)).decode("ascii")
        crypto._reset_key_cache()


def _make_user(c, email: str) -> str:
    with c.cursor() as cur:
        cur.execute(
            "INSERT INTO users (email) VALUES (%s) RETURNING id::text",
            (email,),
        )
        return cur.fetchone()["id"]


def _make_account(c, user_id: str, name: str, token: str = "fake-wb-token-1234") -> str:
    enc = crypto.encrypt_token(token)
    with c.cursor() as cur:
        cur.execute(
            """
            INSERT INTO wb_accounts
              (user_id, name, encrypted_token, token_iv, token_tag, mode)
            VALUES (%s, %s, %s, %s, %s, 'preview')
            RETURNING id::text
            """,
            (user_id, name, enc.ciphertext, enc.iv, enc.tag),
        )
        return cur.fetchone()["id"]


def test_load_active_accounts_decrypts_token_and_attaches_default_preset(conn):
    _ensure_key()
    uid = _make_user(conn, f"test-{uuid.uuid4()}@x.local")
    _make_account(conn, uid, "Тестовый", token="jwt.payload.sig")

    accounts = db.load_active_accounts(conn)
    mine = [a for a in accounts if a.user_id == uid]
    assert len(mine) == 1
    a = mine[0]
    assert a.token == "jwt.payload.sig"
    assert a.is_preview is True
    # Дефолтный пресет «Одежда» должен прикрепиться
    assert a.rules.name == "Одежда"
    assert a.rules.min_views == 40
    assert "dite" in a.rules.banned_keywords


def test_run_lifecycle_create_then_finish_succeeded(conn):
    _ensure_key()
    uid = _make_user(conn, f"test-{uuid.uuid4()}@x.local")
    acc_id = _make_account(conn, uid, "A1")

    run_id = db.create_run(conn, acc_id, "preview")
    assert isinstance(run_id, str)

    db.finish_run(conn, run_id, status="succeeded", summary={"clusters": 42})

    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, finished_at, summary FROM runs WHERE id::text=%s",
            (run_id,),
        )
        row = cur.fetchone()
        assert row["status"] == "succeeded"
        assert row["finished_at"] is not None
        assert row["summary"]["clusters"] == 42


def test_record_decisions_writes_and_marks_applied(conn):
    _ensure_key()
    uid = _make_user(conn, f"test-{uuid.uuid4()}@x.local")
    acc_id = _make_account(conn, uid, "A2")
    run_id = db.create_run(conn, acc_id, "auto")

    inserted = db.record_decisions(
        conn,
        run_id,
        [
            db.DecisionRecord(
                advert_id=100,
                nm_id=200,
                norm_query="дешёвая фраза",
                action="exclude",
                reason_code="low_ctr_no_carts",
                ctr=0.5,
                views=200,
                clicks=1,
                carts=0,
                orders=0,
                was_applied=True,
            ),
            db.DecisionRecord(
                advert_id=100,
                nm_id=200,
                norm_query="полезная фраза",
                action="keep",
                reason_code="protected_by_cart",
                ctr=4.2,
                views=300,
                clicks=12,
                carts=2,
                orders=1,
                was_applied=False,
            ),
        ],
    )
    assert inserted == 2

    with conn.cursor() as cur:
        cur.execute(
            "SELECT action, was_applied, applied_at FROM decisions "
            "WHERE run_id::text=%s ORDER BY norm_query",
            (run_id,),
        )
        rows = cur.fetchall()
        assert {r["action"] for r in rows} == {"exclude", "keep"}
        applied = next(r for r in rows if r["action"] == "exclude")
        kept = next(r for r in rows if r["action"] == "keep")
        assert applied["was_applied"] is True
        assert applied["applied_at"] is not None
        assert kept["was_applied"] is False
        assert kept["applied_at"] is None


def test_minus_cache_idempotent(conn):
    _ensure_key()
    uid = _make_user(conn, f"test-{uuid.uuid4()}@x.local")
    acc_id = _make_account(conn, uid, "A3")

    inserted_1 = db.upsert_minus_cache(
        conn,
        acc_id,
        [(1, 10, "розовый"), (1, 10, "синий"), (2, 11, "слон")],
    )
    inserted_2 = db.upsert_minus_cache(
        conn,
        acc_id,
        [(1, 10, "розовый"), (1, 10, "новый"), (2, 11, "слон")],
    )
    assert inserted_1 == 3
    # розовый+слон уже есть → не дублируются, новый — добавится
    assert inserted_2 == 1

    cache = db.get_minus_cache(conn, acc_id)
    assert (1, 10, "розовый") in cache
    assert (1, 10, "синий") in cache
    assert (1, 10, "новый") in cache
    assert (2, 11, "слон") in cache


def test_push_in_app_notification(conn):
    uid = _make_user(conn, f"test-{uuid.uuid4()}@x.local")
    db.push_in_app_notification(conn, uid, {"kind": "run_summary", "k": 7})
    with conn.cursor() as cur:
        cur.execute(
            "SELECT channel, status, payload FROM notifications WHERE user_id::text=%s",
            (uid,),
        )
        row = cur.fetchone()
        assert row["channel"] == "in_app"
        assert row["status"] == "sent"
        assert row["payload"]["k"] == 7
