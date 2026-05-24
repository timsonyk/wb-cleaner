"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = {
  ok: boolean;
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function startLogin(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Введите корректный email" };
  }

  try {
    // redirect: true (default) — Auth.js сам перекинет на /verify-request.
    // Если он бросает NEXT_REDIRECT — это успех (стандартное поведение).
    await signIn("resend", { email, redirectTo: callbackUrl });
    return { ok: true };
  } catch (err) {
    // NEXT_REDIRECT — нормальный exit-path при успехе, его пропускаем дальше.
    if (
      err instanceof Error &&
      err.message.includes("NEXT_REDIRECT")
    ) {
      throw err;
    }
    if (err instanceof AuthError) {
      return { ok: false, error: "Не удалось отправить письмо. Попробуй ещё раз." };
    }
    throw err;
  }
}
