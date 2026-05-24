"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { decisions, runs, wbAccounts } from "@/lib/db/schema";
import { decryptToken } from "@/lib/crypto/token";
import { unMinusPhrase } from "@/lib/wb-api";
import { requireUser } from "@/lib/auth/require-user";

export interface RevertResult {
  ok: boolean;
  message: string;
}

/**
 * Откат одного решения: убрать фразу из минусов в WB и пометить
 * decision.reverted_at. Работает ТОЛЬКО для was_applied=true и
 * только в рамках аккаунтов текущего юзера (проверка на уровне SQL).
 */
export async function revertDecision(
  _prev: RevertResult,
  formData: FormData,
): Promise<RevertResult> {
  const { userId } = await requireUser();
  const decisionId = String(formData.get("decisionId") ?? "");
  if (!decisionId) {
    return { ok: false, message: "decisionId не задан" };
  }

  // Достаём decision + аккаунт + (зашифрованный) токен. Проверка userId
  // зашита в join → чужие decisions просто не вернутся.
  const [row] = await db
    .select({
      id: decisions.id,
      advertId: decisions.advertId,
      nmId: decisions.nmId,
      normQuery: decisions.normQuery,
      action: decisions.action,
      wasApplied: decisions.wasApplied,
      revertedAt: decisions.revertedAt,
      accountId: wbAccounts.id,
      encryptedToken: wbAccounts.encryptedToken,
      tokenIv: wbAccounts.tokenIv,
      tokenTag: wbAccounts.tokenTag,
    })
    .from(decisions)
    .innerJoin(runs, eq(runs.id, decisions.runId))
    .innerJoin(wbAccounts, eq(wbAccounts.id, runs.wbAccountId))
    .where(and(eq(decisions.id, decisionId), eq(wbAccounts.userId, userId)))
    .limit(1);

  if (!row) {
    return { ok: false, message: "Решение не найдено" };
  }
  if (row.action !== "exclude") {
    return { ok: false, message: "Откатывать имеет смысл только exclude" };
  }
  if (!row.wasApplied) {
    return {
      ok: false,
      message: "Это решение не было применено в WB — откатывать нечего",
    };
  }
  if (row.revertedAt) {
    return { ok: false, message: "Решение уже было откачено ранее" };
  }

  // Расшифровываем токен и идём в WB.
  const token = decryptToken({
    ciphertext: row.encryptedToken,
    iv: row.tokenIv,
    tag: row.tokenTag,
  });

  const res = await unMinusPhrase(
    token,
    Number(row.advertId),
    Number(row.nmId),
    row.normQuery,
  );

  if (!res.ok) {
    if (res.error.kind === "token_invalid") {
      return { ok: false, message: "Токен WB невалиден — переподключи аккаунт" };
    }
    if (res.error.kind === "rate_limited") {
      return {
        ok: false,
        message: `WB ограничил запросы. Повтори через ${res.error.retryAfterSec} сек.`,
      };
    }
    return { ok: false, message: `Ошибка WB: ${res.error.kind}` };
  }

  // Помечаем decision как откатнутое.
  await db
    .update(decisions)
    .set({ revertedAt: new Date() })
    .where(eq(decisions.id, decisionId));

  revalidatePath("/decisions");
  return {
    ok: true,
    message: res.data.removed
      ? "Восстановлено: фраза убрана из минусов WB"
      : "Фраза уже отсутствовала в WB — отметка о возврате поставлена",
  };
}
