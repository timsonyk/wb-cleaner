import { randomInt } from "node:crypto";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db/client";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/lib/db/schema";
import authConfig from "./auth.config";

/** 6-значный код для входа. crypto.randomInt — CSPRNG, без Math.random.
 *  Энтропия 1:1_000_000 — для MVP допустимо при 15-минутной TTL и одноразовом
 *  использовании. Перед prod добавить лимит попыток на (email, IP). */
function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Lazy env guards. Top-level throw ронял `next build` (page data collection
// в worker'ах не видит env, который мы загружаем в next.config). Падать
// надо при первом обращении — в этот момент уже идёт реальный запрос и
// env должен быть на месте.
function requireEnv(key: string, hint?: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(`${key} is not set${hint ? `. ${hint}` : ""}`);
  }
  return v;
}

const MAGIC_LINK_MAX_AGE_SECONDS = 15 * 60;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Resend({
      // apiKey / from подставляются в момент создания провайдера. Если их
      // нет — sendVerificationRequest всё равно упадёт явной ошибкой ниже.
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM,
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
      // Auth.js использует этот токен и как значение в таблице
      // verification_tokens, и как ?token=... в magic-link. Подставляем
      // 6-значный код — он же будет работать как code-вход через форму.
      generateVerificationToken: generateLoginCode,
      async sendVerificationRequest({ identifier: to, url, token }) {
        // DEV-fallback: если Resend ещё не настроен (placeholder ключа) или
        // явно сказали NEXT_AUTH_DEV_PRINT_LINK=1 — печатаем код в лог
        // вместо отправки письма. Удобно гонять локально без аккаунта Resend.
        const rawKey = process.env.AUTH_RESEND_KEY ?? "";
        const isPlaceholder =
          rawKey === "" ||
          rawKey.includes("placeholder") ||
          process.env.NEXT_AUTH_DEV_PRINT_LINK === "1";
        if (isPlaceholder && process.env.NODE_ENV !== "production") {
          console.log("\n" + "═".repeat(72));
          console.log(`📧 [DEV] код для ${to}:  ${token}`);
          console.log(`   (или magic-link: ${url})`);
          console.log(`   живёт 15 минут`);
          console.log("═".repeat(72) + "\n");
          return;
        }

        const apiKey = requireEnv(
          "AUTH_RESEND_KEY",
          "Get one from https://resend.com/api-keys",
        );
        const from = requireEnv(
          "EMAIL_FROM",
          "e.g. 'WB Cleaner <onboarding@resend.dev>'",
        );

        const subject = `Код для входа в WB Cleaner: ${token}`;
        const text = `Ваш код для входа: ${token}\n\nВведите его на странице входа. Действует 15 минут.\n\nИли откройте ссылку: ${url}`;
        const html = `<p>Ваш код для входа:</p>
<p style="font-family:monospace;font-size:28px;letter-spacing:4px;font-weight:600">${token}</p>
<p>Введите его на странице входа. Код действует 15 минут.</p>
<p style="color:#888;font-size:12px">Или откройте <a href="${url}">эту ссылку</a> — войдёте без ввода кода.</p>`;

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, text, html }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Resend failed: ${res.status} ${body}`);
        }
      },
    }),
  ],
});
