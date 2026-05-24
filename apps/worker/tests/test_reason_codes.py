import pytest
from wb_cleaner_core.reason_codes import rule_to_code


def test_known_rules_all_map():
    cases = {
        "запрещённое слово": "banned_keyword",
        "недостаточно данных": "insufficient_data",
        "защита заказом": "protected_by_order",
        "защита корзиной": "protected_by_cart",
        "защита топа (слабая кампания)": "protected_top_weak",
        "гарантия минимума": "protected_min_alive",
        "низкий CTR без корзин": "low_ctr_no_carts",
        "норма": "above_threshold",
    }
    for rule, expected in cases.items():
        assert rule_to_code(rule) == expected


def test_unknown_rule_raises():
    with pytest.raises(ValueError):
        rule_to_code("какая-то новая фраза которой нет в маппинге")


def test_empty_raises():
    with pytest.raises(ValueError):
        rule_to_code("")
