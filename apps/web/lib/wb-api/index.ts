import type { WbAdvert, WbResult, MinusPhrases } from "./types";
import { wbRequest } from "./client";

export type { WbApiError, WbResult, WbAdvert, MinusPhrases } from "./types";
export { maskToken, formatErrorForLog, WB_BASE_URL } from "./client";

// ─────────────────────────────────────────────────────────────────────────────
// validateToken
// ─────────────────────────────────────────────────────────────────────────────

interface PromotionCountResponse {
  adverts?: Array<{
    type: number;
    status: number;
    count: number;
    advert_list?: Array<{ advertId: number; changeTime?: string }>;
  }>;
  all?: number;
}

/**
 * Проверка JWT-токена WB. Дёргает лёгкий /adv/v1/promotion/count.
 * Используется при онбординге и в фоновой ежечасной валидации (которая пока
 * отложена). На 401/403 → {valid:false}.
 *
 * fetchImpl — для unit-тестов.
 */
export async function validateToken(
  jwt: string,
  fetchImpl?: typeof fetch,
): Promise<{ valid: boolean; reason?: string; campaignsCount?: number }> {
  const res = await wbRequest<PromotionCountResponse>({
    method: "GET",
    path: "/adv/v1/promotion/count",
    token: jwt,
    fetchImpl,
  });

  if (res.ok) {
    const total = res.data.all ?? 0;
    return { valid: true, campaignsCount: total };
  }

  if (res.error.kind === "token_invalid") {
    return { valid: false, reason: "Токен невалиден или отозван" };
  }
  if (res.error.kind === "rate_limited") {
    return {
      valid: false,
      reason: `WB ограничил запросы (повторите через ${res.error.retryAfterSec} сек)`,
    };
  }
  if (res.error.kind === "timeout" || res.error.kind === "network_error") {
    return { valid: false, reason: "Сетевая ошибка, попробуйте позже" };
  }
  return { valid: false, reason: "Не удалось проверить токен (ошибка WB)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// listAdverts
// ─────────────────────────────────────────────────────────────────────────────

interface AdvertsResponse {
  adverts?: Array<{
    id?: number;
    advertId?: number;
    name?: string;
    settings?: { name?: string };
    status?: number;
    type?: number;
  }>;
}

/**
 * Список рекламных кампаний с деталями. Внимание: WB лимитирует
 * /api/advert/v2/adverts до 1 запроса в час на seller. Использовать только
 * при онбординге для первичного показа — результат сразу кэшируем в UI.
 */
export async function listAdverts(
  jwt: string,
  advertIds: number[],
  fetchImpl?: typeof fetch,
): Promise<WbResult<WbAdvert[]>> {
  if (advertIds.length === 0) return { ok: true, data: [] };

  const BATCH = 50;
  const all: WbAdvert[] = [];
  for (let i = 0; i < advertIds.length; i += BATCH) {
    const chunk = advertIds.slice(i, i + BATCH);
    const res = await wbRequest<AdvertsResponse>({
      method: "GET",
      path: "/api/advert/v2/adverts",
      token: jwt,
      query: { ids: chunk.join(",") },
      fetchImpl,
    });
    if (!res.ok) return res;
    const adverts = res.data.adverts ?? [];
    for (const a of adverts) {
      const id = a.id ?? a.advertId;
      if (!id) continue;
      all.push({
        id,
        name: a.settings?.name ?? a.name ?? `Campaign ${id}`,
        status: a.status ?? 0,
        type: a.type ?? 0,
      });
    }
  }
  return { ok: true, data: all };
}

// ─────────────────────────────────────────────────────────────────────────────
// getMinusPhrases / setMinusPhrases / unMinusPhrase
// ─────────────────────────────────────────────────────────────────────────────

interface GetMinusResponse {
  items?: Array<{ advertId?: number; nmId?: number; queries?: string[] }>;
}

/** Текущий список минус-фраз для пары (advertId, nmId). */
export async function getMinusPhrases(
  jwt: string,
  advertId: number,
  nmId: number,
  fetchImpl?: typeof fetch,
): Promise<WbResult<MinusPhrases>> {
  const res = await wbRequest<GetMinusResponse>({
    method: "POST",
    path: "/adv/v0/normquery/get-minus",
    token: jwt,
    body: { advert_id: advertId, nm_id: nmId },
    fetchImpl,
  });
  if (!res.ok) return res;
  const item = (res.data.items ?? [])[0];
  return {
    ok: true,
    data: {
      advertId,
      nmId,
      phrases: item?.queries ?? [],
    },
  };
}

/**
 * ВНИМАНИЕ: set-minus в WB Promotion API — это REPLACE, а не append.
 * Тело запроса = ПОЛНЫЙ финальный список минус-фраз для (advertId, nmId).
 * Что в новом запросе → останется минусом. Чего нет → перестанет быть минусом.
 * Любая модификация ОБЯЗАНА начинаться с getMinusPhrases().
 */
export async function setMinusPhrases(
  jwt: string,
  advertId: number,
  nmId: number,
  phrases: string[],
  fetchImpl?: typeof fetch,
): Promise<WbResult<void>> {
  const res = await wbRequest<void>({
    method: "POST",
    path: "/adv/v0/normquery/set-minus",
    token: jwt,
    body: {
      advert_id: advertId,
      nm_id: nmId,
      queries: phrases,
    },
    fetchImpl,
  });
  if (!res.ok) return res;
  return { ok: true, data: undefined };
}

/**
 * Убрать одну фразу из минусов для (advertId, nmId).
 * Двухшаговый: get-minus → отбросить целевую → set-minus с остатком.
 * Использует case-insensitive сравнение (WB нормализует фразы).
 */
export async function unMinusPhrase(
  jwt: string,
  advertId: number,
  nmId: number,
  phrase: string,
  fetchImpl?: typeof fetch,
): Promise<WbResult<{ removed: boolean; remaining: number }>> {
  const current = await getMinusPhrases(jwt, advertId, nmId, fetchImpl);
  if (!current.ok) return current;

  const targetLower = phrase.toLowerCase();
  const remaining = current.data.phrases.filter(
    (p) => p.toLowerCase() !== targetLower,
  );
  const removed = remaining.length < current.data.phrases.length;

  if (!removed) {
    return { ok: true, data: { removed: false, remaining: remaining.length } };
  }

  const updated = await setMinusPhrases(
    jwt,
    advertId,
    nmId,
    remaining,
    fetchImpl,
  );
  if (!updated.ok) return updated;

  return { ok: true, data: { removed: true, remaining: remaining.length } };
}
