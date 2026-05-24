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
      async sendVerificationRequest({ identifier: to, url }) {
        // DEV-fallback: если Resend ещё не настроен (placeholder ключа) или
        // явно сказали NEXT_AUTH_DEV_PRINT_LINK=1 — печатаем ссылку в лог
        // вместо отправки письма. Удобно гонять локально без аккаунта Resend.
        const rawKey = process.env.AUTH_RESEND_KEY ?? "";
        const isPlaceholder =
          rawKey === "" ||
          rawKey.includes("placeholder") ||
          process.env.NEXT_AUTH_DEV_PRINT_LINK === "1";
        if (isPlaceholder && process.env.NODE_ENV !== "production") {
          console.log("\n" + "═".repeat(72));
          console.log(`📧 [DEV] magic link для ${to}:`);
          console.log(`   ${url}`);
          console.log(`   (живёт 15 минут, открой её в браузере)`);
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

        const subject = "Войти в WB Cleaner — нажмите ссылку";
        const text = `Откройте ссылку, чтобы войти в WB Cleaner:\n${url}\n\nСсылка живёт 15 минут.`;
        const html = `<p>Откройте ссылку, чтобы войти в WB Cleaner:</p>
<p><a href="${url}">${url}</a></p>
<p style="color:#888;font-size:12px">Ссылка живёт 15 минут.</p>`;

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
