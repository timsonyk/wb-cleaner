"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  rulesProfiles,
  wbAccountRules,
  wbAccounts,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { DEFAULT_PRESET_NAME } from "@wb-cleaner/shared-types";

export type SaveRulesResult =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; message: string };

const NUM = (v: FormDataEntryValue | null): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

interface ParsedRules {
  minViews: number;
  minCtr: number;
  weakCampaignCtr: number;
  minCartsToProtect: number;
  topKeepPct: number;
  minClustersAlive: number;
  bannedKeywords: string[];
  useDynamicCtr: boolean;
  minDynamicCtr: number;
}

function parseRules(form: FormData): ParsedRules | { error: string } {
  const minViews = NUM(form.get("minViews"));
  const minCtr = NUM(form.get("minCtr"));
  const weakCampaignCtr = NUM(form.get("weakCampaignCtr"));
  const minCartsToProtect = NUM(form.get("minCartsToProtect"));
  const topKeepPct = NUM(form.get("topKeepPct"));
  const minClustersAlive = NUM(form.get("minClustersAlive"));
  const minDynamicCtr = NUM(form.get("minDynamicCtr"));

  if (minViews == null || minViews < 1) return { error: "«Мин. показов» должно быть ≥ 1" };
  if (minCtr == null || minCtr < 0) return { error: "«Мин. CTR» не может быть отрицательным" };
  if (weakCampaignCtr == null || weakCampaignCtr < 0) return { error: "«Слабая кампания CTR» не может быть отрицательным" };
  if (minCartsToProtect == null || minCartsToProtect < 0) return { error: "«Корзин для защиты» ≥ 0" };
  if (topKeepPct == null || topKeepPct < 0 || topKeepPct > 1) return { error: "«Топ слабой РК» — доля от 0 до 1 (0.20 = 20%)" };
  if (minClustersAlive == null || minClustersAlive < 1) return { error: "«Гарантия минимума» ≥ 1" };
  if (minDynamicCtr == null || minDynamicCtr < 0) return { error: "«Мин. CTR (динамика)» ≥ 0" };

  const bannedRaw = String(form.get("bannedKeywords") ?? "");
  const bannedKeywords = bannedRaw
    .split(/[\n,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    minViews: Math.round(minViews),
    minCtr,
    weakCampaignCtr,
    minCartsToProtect: Math.round(minCartsToProtect),
    topKeepPct,
    minClustersAlive: Math.round(minClustersAlive),
    bannedKeywords,
    useDynamicCtr: form.get("useDynamicCtr") === "on",
    minDynamicCtr,
  };
}

/**
 * Сохранить правила для аккаунта. Если текущее правило — пресет, форкаем
 * (создаём свой is_preset=false с user_id юзера) и переключаем wb_account_rules.
 * Если уже свой профиль — обновляем in-place.
 */
export async function saveRules(
  _prev: SaveRulesResult,
  formData: FormData,
): Promise<SaveRulesResult> {
  const { userId } = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { status: "error", error: "accountId не задан" };

  // Аккаунт должен принадлежать юзеру.
  const [account] = await db
    .select({ id: wbAccounts.id, name: wbAccounts.name })
    .from(wbAccounts)
    .where(and(eq(wbAccounts.id, accountId), eq(wbAccounts.userId, userId)))
    .limit(1);
  if (!account) return { status: "error", error: "Аккаунт не найден" };

  const parsed = parseRules(formData);
  if ("error" in parsed) return { status: "error", error: parsed.error };

  // Текущее правило этого аккаунта.
  const [link] = await db
    .select({
      profileId: rulesProfiles.id,
      isPreset: rulesProfiles.isPreset,
      profileName: rulesProfiles.name,
    })
    .from(wbAccountRules)
    .innerJoin(rulesProfiles, eq(rulesProfiles.id, wbAccountRules.rulesProfileId))
    .where(eq(wbAccountRules.wbAccountId, accountId))
    .limit(1);

  if (!link) return { status: "error", error: "К аккаунту не привязан профиль правил" };

  if (link.isPreset) {
    // Форк: создаём свой кастомный профиль и переключаем связь.
    const [created] = await db
      .insert(rulesProfiles)
      .values({
        userId,
        name: `${account.name} (свой)`,
        isPreset: false,
        minViews: parsed.minViews,
        minCtr: parsed.minCtr,
        weakCampaignCtr: parsed.weakCampaignCtr,
        minCartsToProtect: parsed.minCartsToProtect,
        topKeepPct: parsed.topKeepPct,
        minClustersAlive: parsed.minClustersAlive,
        bannedKeywords: parsed.bannedKeywords,
        useDynamicCtr: parsed.useDynamicCtr,
        minDynamicCtr: parsed.minDynamicCtr,
      })
      .returning({ id: rulesProfiles.id });
    await db
      .update(wbAccountRules)
      .set({ rulesProfileId: created.id })
      .where(eq(wbAccountRules.wbAccountId, accountId));
  } else {
    // Уже свой — редактируем in-place.
    await db
      .update(rulesProfiles)
      .set({
        minViews: parsed.minViews,
        minCtr: parsed.minCtr,
        weakCampaignCtr: parsed.weakCampaignCtr,
        minCartsToProtect: parsed.minCartsToProtect,
        topKeepPct: parsed.topKeepPct,
        minClustersAlive: parsed.minClustersAlive,
        bannedKeywords: parsed.bannedKeywords,
        useDynamicCtr: parsed.useDynamicCtr,
        minDynamicCtr: parsed.minDynamicCtr,
      })
      .where(and(eq(rulesProfiles.id, link.profileId), eq(rulesProfiles.userId, userId)));
  }

  revalidatePath(`/accounts/${accountId}/rules`);
  return { status: "ok", message: "Правила сохранены" };
}

/** Сбросить правила обратно на дефолтный пресет. */
export async function resetToPreset(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return;

  const [owned] = await db
    .select({ id: wbAccounts.id })
    .from(wbAccounts)
    .where(and(eq(wbAccounts.id, accountId), eq(wbAccounts.userId, userId)))
    .limit(1);
  if (!owned) return;

  const [preset] = await db
    .select({ id: rulesProfiles.id })
    .from(rulesProfiles)
    .where(and(eq(rulesProfiles.isPreset, true), eq(rulesProfiles.name, DEFAULT_PRESET_NAME)))
    .limit(1);
  if (!preset) return;

  await db
    .update(wbAccountRules)
    .set({ rulesProfileId: preset.id })
    .where(eq(wbAccountRules.wbAccountId, accountId));

  revalidatePath(`/accounts/${accountId}/rules`);
  redirect(`/accounts/${accountId}/rules`);
}
