"""Общие fixtures для pytest. Чистим env-кэш ключа между тестами."""
from __future__ import annotations

import base64
import os

import pytest

from wb_cleaner_core import crypto


@pytest.fixture
def fresh_key() -> str:
    """Сгенерировать новый ключ и положить в env. Каждый тест получает свой."""
    key_b64 = base64.b64encode(os.urandom(32)).decode("ascii")
    old = os.environ.get(crypto.ENV_VAR)
    os.environ[crypto.ENV_VAR] = key_b64
    crypto._reset_key_cache()
    yield key_b64
    if old is None:
        os.environ.pop(crypto.ENV_VAR, None)
    else:
        os.environ[crypto.ENV_VAR] = old
    crypto._reset_key_cache()
