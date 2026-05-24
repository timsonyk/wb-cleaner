import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "./auth.config";
import { isProtected } from "@/lib/auth/protected-routes";

// Отдельный NextAuth-инстанс на edge: импортирует ТОЛЬКО auth.config.
// auth.ts притаскивает postgres/drizzle-adapter, которые в Edge Runtime
// не работают.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (!isProtected(pathname)) return NextResponse.next();
  if (req.auth) return NextResponse.next();

  const loginUrl = new URL("/login", req.nextUrl);
  // ?callbackUrl=... — куда вернуться после логина.
  loginUrl.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(loginUrl);
});

// _next/static и т.п. — пропускаем; собственные `/api/auth/*` пропускаем
// (их обрабатывает сам Auth.js).
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
