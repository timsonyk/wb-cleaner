"""AES-256-GCM шифрование токенов WB. Бинарно совместимо с TS-стороной
(apps/web/lib/crypto/token.ts).

Контракт (источник правды — TS-сторона, мы её зеркалим):
- алгоритм:  AES-256-GCM
- ключ:      ровно 32 байта, читаются из TOKEN_ENCRYPTION_KEY (base64) в env
- IV:        12 байт, рандомных на каждый encrypt
- tag:       16 байт, append-семантика GCM
- on-wire:   три base64-строки в БД — encrypted_token, token_iv, token_tag

Никогда не логируй сам токен. Если очень нужно — только последние 4 символа.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LENGTH = 12
TAG_LENGTH = 16
KEY_LENGTH = 32
ENV_VAR = "TOKEN_ENCRYPTION_KEY"


@dataclass(frozen=True)
class EncryptedToken:
    """То же самое, что вернёт TS encryptToken() — три поля base64."""

    ciphertext: str
    iv: str
    tag: str


@lru_cache(maxsize=1)
def get_key() -> bytes:
    """Достаёт ключ из env. Кэшируется для не-первого вызова."""
    raw = os.environ.get(ENV_VAR)
    if not raw:
        raise RuntimeError(
            f"{ENV_VAR} is not set. Generate one with: "
            "python -c \"import os,base64; print(base64.b64encode(os.urandom(32)).decode())\""
        )
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise RuntimeError(f"{ENV_VAR} is not valid base64: {exc}") from exc
    if len(key) != KEY_LENGTH:
        raise RuntimeError(
            f"{ENV_VAR} must decode to {KEY_LENGTH} bytes (got {len(key)})"
        )
    return key


def _reset_key_cache() -> None:
    """Сбросить кэш ключа — нужно тестам, которые меняют env между кейсами."""
    get_key.cache_clear()


def encrypt_token(plaintext: str) -> EncryptedToken:
    """Зашифровать строку. Возвращает три base64 — те же поля, что у TS."""
    if not isinstance(plaintext, str) or plaintext == "":
        raise ValueError("encrypt_token: plaintext must be a non-empty string")

    key = get_key()
    iv = os.urandom(IV_LENGTH)
    aes = AESGCM(key)
    # AESGCM в cryptography пишет ciphertext || tag единым буфером.
    ct_and_tag = aes.encrypt(iv, plaintext.encode("utf-8"), associated_data=None)
    # Отделяем tag (последние 16 байт), чтобы лечь в три поля БД.
    ciphertext = ct_and_tag[:-TAG_LENGTH]
    tag = ct_and_tag[-TAG_LENGTH:]

    return EncryptedToken(
        ciphertext=base64.b64encode(ciphertext).decode("ascii"),
        iv=base64.b64encode(iv).decode("ascii"),
        tag=base64.b64encode(tag).decode("ascii"),
    )


def decrypt_token(record: EncryptedToken) -> str:
    """Расшифровать. Бросает InvalidTag (cryptography.exceptions) при подделке."""
    key = get_key()
    iv = base64.b64decode(record.iv, validate=True)
    tag = base64.b64decode(record.tag, validate=True)
    ciphertext = base64.b64decode(record.ciphertext, validate=True)

    if len(iv) != IV_LENGTH:
        raise ValueError(f"decrypt_token: invalid iv length ({len(iv)})")
    if len(tag) != TAG_LENGTH:
        raise ValueError(f"decrypt_token: invalid tag length ({len(tag)})")

    aes = AESGCM(key)
    # cryptography ожидает на входе ciphertext || tag единой строкой.
    plain_bytes = aes.decrypt(iv, ciphertext + tag, associated_data=None)
    return plain_bytes.decode("utf-8")


def mask_token(jwt: str) -> str:
    """Показываем только последние 4 символа. Использовать в логах."""
    if not jwt:
        return "<empty>"
    if len(jwt) <= 8:
        return "***"
    return f"***{jwt[-4:]}"
