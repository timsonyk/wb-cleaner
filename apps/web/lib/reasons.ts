import type { ReasonCode } from "@wb-cleaner/shared-types";

const LABELS: Record<ReasonCode, string> = {
  low_ctr_no_carts: "Низкий CTR без корзин",
  banned_keyword: "Запрещённое слово",
  insufficient_data: "Мало данных",
  protected_by_cart: "Защита: есть корзины",
  protected_by_order: "Защита: есть заказы",
  protected_top_weak: "Защита: топ в слабой кампании",
  protected_min_alive: "Защита: гарантия минимума",
  above_threshold: "CTR в норме",
};

export function reasonLabel(code: ReasonCode | string): string {
  return LABELS[code as ReasonCode] ?? code;
}
