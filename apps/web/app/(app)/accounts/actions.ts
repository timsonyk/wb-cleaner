"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { spawn } from "node:child_process";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  wbAccounts,
  wbAccountRules,
  rulesProfiles,
} from "@/lib/db/schema";
import { encryptToken } from "@/lib/crypto/token";
import { validateToken } from "@/lib/wb-api";
import { requireUser } from "@/lib/auth/require-user";
import { DEFAULT_PRESET_NAME } from "@wb-cleaner/shared-types";

export type AddAccountState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; accountId: string };

const PREVIEW_DAYS = 7;

export async function addAccount(
  _prev: AddAccountState,
  formData: FormData,
): Promise<AddAccountState> {
  const { userId } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!name) return { status: "error", error: "Введите имя аккаунта" };
  if (!token) return { status: "error", error: "Вставьте JWT-токен" };
  if (token.length < 32) {
    return { status: "error", error: "Токен слишком короткий — это точно JWT?" };
  }

  const check = await validateToken(token);
  if (!check.valid) {
    return {
      status: "error",
      error: check.reason ?? "Токен невалиден",
    };
  }

  const [preset] = await db
    .select({ id: rulesProfiles.id })
    .from(rulesProfiles)
    .where(
      and(
        eq(rulesProfiles.isPreset, true),
        eq(rulesProfiles.name, DEFAULT_PRESET_NAME),
      ),
    )
    .limit(1);

  if (!preset) {
    return {
      status: "error",
      error: `Не найден дефолтный пресет «${DEFAULT_PRESET_NAME}». Запусти \`pnpm db:seed\`.`,
    };
  }

  const enc = encryptToken(token);
  const previewUntil = new Date();
  previewUntil.setDate(previewUntil.getDate() + PREVIEW_DAYS);

  const [created] = await db
    .insert(wbAccounts)
    .values({
      userId,
      name,
      encryptedToken: enc.ciphertext,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      mode: "preview",
      previewUntil,
      lastValidatedAt: new Date(),
    })
    .returning({ id: wbAccounts.id });

  await db.insert(wbAccountRules).values({
    wbAccountId: created.id,
    rulesProfileId: preset.id,
  });

  revalidatePath("/accounts");
  redirect(`/accounts?new=${created.id}`);
}

export async function deleteAccount(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // ON DELETE CASCADE снесёт wb_account_rules, runs, decisions, minus_cache.
  await db
    .delete(wbAccounts)
    .where(and(eq(wbAccounts.id, id), eq(wbAccounts.userId, userId)));

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

// ─────────────────────────────────────────────────────────────────────────────
// «Запустить сейчас»
// Локальный запуск Python-воркера. Только для dev: на проде воркер живёт на
// отдельной машине, тогда здесь должна быть отправка в очередь, а не spawn.
// ─────────────────────────────────────────────────────────────────────────────

export type RunNowResult = { ok: boolean; message: string };

export async function runNow(
  _prev: RunNowResult,
  formData: FormData,
): Promise<RunNowResult> {
  const { userId } = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { ok: false, message: "accountId не задан" };

  // Защита: чужой аккаунт запустить нельзя.
  const [owned] = await db
    .select({ id: wbAccounts.id, name: wbAccounts.name })
    .from(wbAccounts)
    .where(and(eq(wbAccounts.id, accountId), eq(wbAccounts.userId, userId)))
    .limit(1);
  if (!owned) return { ok: false, message: "Аккаунт не найден" };

  // Spawn-python работает только в dev (см. комментарий выше — на проде
  // нужна очередь, а не локальный child_process). Явный guard, чтобы
  // в проде кнопка не «успешно запустила» в пустоту.
  if (process.env.NODE_ENV !== "development") {
    return {
      ok: false,
      message:
        "Запуск из UI доступен только в dev. На проде воркер тянет задачи из очереди.",
    };
  }

  // apps/web/app/(app)/accounts/actions.ts  → ../../../  = apps/web → apps/worker
  const webRoot = path.resolve(process.cwd()); // pnpm dev запускает из apps/web
  const workerRoot = path.resolve(webRoot, "..", "worker");
  const python = path.join(workerRoot, ".venv", "bin", "python");
  const cli = path.join(workerRoot, "cli.py");

  try {
    const proc = spawn(python, [cli, "--account-id", accountId, "-v"], {
      cwd: workerRoot,
      // detached + stdio:ignore — процесс живёт после возврата action'а.
      // Логи попадут в системный stdout dev-сервера.
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    proc.unref();
    console.log(
      `[runNow] spawned worker pid=${proc.pid} account=${owned.name} (${accountId})`,
    );
  } catch (err) {
    return {
      ok: false,
      message: `Не удалось запустить воркер: ${(err as Error).message}`,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/decisions");
  return {
    ok: true,
    message:
      "Запустил. Воркер работает в фоне. Через 30–60 секунд обнови дашборд, чтобы увидеть результат.",
  };
}
