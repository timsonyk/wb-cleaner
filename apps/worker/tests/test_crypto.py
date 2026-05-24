"""Юнит-тесты Python crypto + cross-language: TS↔Python через node-bridge."""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag

from wb_cleaner_core import crypto

NODE_BRIDGE = Path(__file__).parent.parent / "scripts" / "crypto_bridge.mjs"


def test_round_trip(fresh_key):
    plain = "eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYwMzAydjEiLCJ0eXAiOiJKV1QifQ.payload.sig"
    enc = crypto.encrypt_token(plain)
    assert enc.ciphertext and enc.iv and enc.tag
    assert crypto.decrypt_token(enc) == plain


def test_unicode_and_long(fresh_key):
    plain = "Привет мир " + ("x" * 4096)
    enc = crypto.encrypt_token(plain)
    assert crypto.decrypt_token(enc) == plain


def test_different_iv_each_call(fresh_key):
    a = crypto.encrypt_token("same")
    b = crypto.encrypt_token("same")
    assert a.iv != b.iv
    assert a.ciphertext != b.ciphertext


def test_tampered_tag_raises(fresh_key):
    enc = crypto.encrypt_token("secret")
    tampered = crypto.EncryptedToken(
        ciphertext=enc.ciphertext,
        iv=enc.iv,
        tag=base64.b64encode(b"\x00" * 16).decode("ascii"),
    )
    with pytest.raises(InvalidTag):
        crypto.decrypt_token(tampered)


def test_tampered_ciphertext_raises(fresh_key):
    enc = crypto.encrypt_token("secret")
    raw = bytearray(base64.b64decode(enc.ciphertext))
    raw[0] ^= 0xFF
    tampered = crypto.EncryptedToken(
        ciphertext=base64.b64encode(bytes(raw)).decode("ascii"),
        iv=enc.iv,
        tag=enc.tag,
    )
    with pytest.raises(InvalidTag):
        crypto.decrypt_token(tampered)


def test_missing_env_raises():
    old = os.environ.pop(crypto.ENV_VAR, None)
    crypto._reset_key_cache()
    try:
        with pytest.raises(RuntimeError, match=crypto.ENV_VAR):
            crypto.encrypt_token("x")
    finally:
        if old is not None:
            os.environ[crypto.ENV_VAR] = old
        crypto._reset_key_cache()


def test_wrong_key_length_raises():
    os.environ[crypto.ENV_VAR] = base64.b64encode(b"\x01" * 16).decode("ascii")
    crypto._reset_key_cache()
    try:
        with pytest.raises(RuntimeError, match="32 bytes"):
            crypto.encrypt_token("x")
    finally:
        os.environ.pop(crypto.ENV_VAR, None)
        crypto._reset_key_cache()


# ── Cross-language ──
# Используем node-bridge (pure Node, без TS-сборки). Это второй независимый
# инстанс протокола: если TS и Python оба соответствуют ему — формат корректен.


def _node_available() -> bool:
    return shutil.which("node") is not None


@pytest.mark.skipif(not _node_available(), reason="node не найден в PATH")
def test_python_decrypts_node_ciphertext(fresh_key):
    """Шифруем в Node → расшифровываем в Python. Plaintext должен совпасть."""
    plain = "wb-jwt-fake.payload.signature"
    res = subprocess.run(
        ["node", str(NODE_BRIDGE), "encrypt", fresh_key, plain],
        capture_output=True,
        text=True,
        check=True,
    )
    record = json.loads(res.stdout)
    decrypted = crypto.decrypt_token(
        crypto.EncryptedToken(
            ciphertext=record["ciphertext"],
            iv=record["iv"],
            tag=record["tag"],
        )
    )
    assert decrypted == plain


@pytest.mark.skipif(not _node_available(), reason="node не найден в PATH")
def test_node_decrypts_python_ciphertext(fresh_key):
    """Шифруем в Python → расшифровываем в Node. Plaintext должен совпасть."""
    plain = "wb-jwt-fake.payload.signature"
    enc = crypto.encrypt_token(plain)
    payload = json.dumps({"ciphertext": enc.ciphertext, "iv": enc.iv, "tag": enc.tag})
    res = subprocess.run(
        ["node", str(NODE_BRIDGE), "decrypt", fresh_key, payload],
        capture_output=True,
        text=True,
        check=True,
    )
    assert res.stdout.strip() == plain
