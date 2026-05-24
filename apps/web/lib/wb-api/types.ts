// Доменные типы для WB Promotion API. Минимум, нужный текущему функционалу
// (онбординг + audit rollback). Расширяем при появлении новых вызовов.

/** Структурированная ошибка WB-клиента. Возвращается в Result.err, не throw'ится. */
export type WbApiError =
  | { kind: "token_invalid"; status: 401 | 403; message: string }
  | { kind: "rate_limited"; retryAfterSec: number; message: string }
  | { kind: "network_error"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "bad_response"; status: number; message: string };

/** Result-обёртка. Никогда не throw — всегда явный исход. */
export type WbResult<T> = { ok: true; data: T } | { ok: false; error: WbApiError };

/** Одна рекламная кампания (списочное представление). */
export interface WbAdvert {
  id: number;
  name: string;
  status: number; // 9=активная, 11=приостановленная, ...
  type: number;
}

/** Пара (advert, nm) с известным набором минус-фраз. */
export interface MinusPhrases {
  advertId: number;
  nmId: number;
  phrases: string[];
}
