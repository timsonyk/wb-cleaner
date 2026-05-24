import type { NextAuthConfig } from "next-auth";

// Edge-safe конфиг: НИЧЕГО что тянет за собой Node-only зависимости
// (postgres, drizzle-adapter и т.п.). Расширяется в auth.ts для рантайма
// сервера, а middleware импортирует только этот файл.
//
// Auth.js v5 разрешает providers: [] здесь — полный список с apiKey
// определяется в auth.ts.
export default {
  providers: [],
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  // JWT-стратегия: middleware на edge может проверить сессию через cookie
  // без обращения к БД. Adapter всё равно пишет users / verification_tokens —
  // мы теряем только хранение sessions в таблице, что для MVP допустимо.
  session: { strategy: "jwt" },
  callbacks: {
    // jwt.sub содержит user.id из adapter'a (он же id в таблице users).
    // По умолчанию Auth.js v5 не прокидывает его в session.user.id —
    // делаем явно, иначе server actions не смогут получить userId.
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
