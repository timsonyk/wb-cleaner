"use server";

import { redirect } from "next/navigation";
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
    // redirect: false — signIn только триггерит отправку кода и пишет токен
    // в verification_tokens, но не редиректит сам. Дальше редиректим вручную,
    // прокидывая email и callbackUrl в /verify-request, чтобы форма ввода
    // кода знала с какой почтой связан код.
    await signIn("resend", { email, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "Не удалось отправить код. Попробуйте ещё раз." };
    }
    throw err;
  }

  redirect(
    `/verify-request?email=${encodeURIComponent(email)}` +
      `&callbackUrl=${encodeURIComponent(callbackUrl)}`,
  );
}
