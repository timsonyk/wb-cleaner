"""Маппинг `Decision.rule` (русская строка из старого кода) → `reason_code`
enum в БД. Список enum'ов — в apps/web/lib/db/schema.ts → reasonCodeEnum.
Меняешь enum — меняй здесь.
"""
from __future__ import annotations

# 8 кодов: точно как в schema.ts.
LOW_CTR_NO_CARTS = "low_ctr_no_carts"
BANNED_KEYWORD = "banned_keyword"
INSUFFICIENT_DATA = "insufficient_data"
PROTECTED_BY_CART = "protected_by_cart"
PROTECTED_BY_ORDER = "protected_by_order"
PROTECTED_TOP_WEAK = "protected_top_weak"
PROTECTED_MIN_ALIVE = "protected_min_alive"
ABOVE_THRESHOLD = "above_threshold"

# Сопоставление точных подстрок rule → enum. Используем substring match
# (а не равенство), потому что в старом коде `rule` бывает с уточнениями
# в скобках. Проверяем по порядку, первое попадание — победитель.
_RULES_TO_CODE: list[tuple[str, str]] = [
    ("запрещённое слово", BANNED_KEYWORD),
    ("недостаточно данных", INSUFFICIENT_DATA),
    ("защита заказом", PROTECTED_BY_ORDER),
    ("защита корзиной", PROTECTED_BY_CART),
    ("защита топа", PROTECTED_TOP_WEAK),
    ("гарантия минимума", PROTECTED_MIN_ALIVE),
    ("низкий CTR без корзин", LOW_CTR_NO_CARTS),
    ("низкий CTR", LOW_CTR_NO_CARTS),
    ("норма", ABOVE_THRESHOLD),
]


def rule_to_code(rule: str) -> str:
    """Преобразует Decision.rule в reason_code. Если совпадений нет —
    бросает ValueError. Это намеренно: новый rule = миграция БД."""
    if not rule:
        raise ValueError("rule_to_code: empty rule")
    rule_l = rule.lower()
    for needle, code in _RULES_TO_CODE:
        if needle.lower() in rule_l:
            return code
    raise ValueError(
        f"rule_to_code: unknown rule {rule!r}. "
        "Если правило новое — добавь enum в schema.ts И маппинг здесь."
    )
