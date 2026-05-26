import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PageProps {
  searchParams: Promise<{
    email?: string;
    callbackUrl?: string;
    error?: string;
  }>;
}

export default async function VerifyRequestPage({ searchParams }: PageProps) {
  const { email, callbackUrl = "/dashboard", error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full border p-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="size-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Введите код из письма
          </h1>
          {email ? (
            <p className="text-sm text-muted-foreground">
              Мы отправили 6-значный код на{" "}
              <span className="text-foreground">{email}</span>.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Мы отправили 6-значный код на ваш email.
            </p>
          )}
        </div>

        {/* Форма уходит GET на штатный callback Auth.js. Token — это и есть
            код, который мы кладём в verification_tokens (см. auth.ts).
            Если код правильный — Auth.js создаёт сессию и редиректит на
            callbackUrl. Если нет — кидает на /api/auth/error. */}
        <form
          method="GET"
          action="/api/auth/callback/resend"
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          {email ? <input type="hidden" name="email" value={email} /> : null}

          {!email ? (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="token">
              Код
            </label>
            <Input
              id="token"
              name="token"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              minLength={6}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              required
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
          </div>

          {error ? (
            <p
              className="rounded-md border border-foreground/20 bg-muted/30 px-3 py-2 text-sm"
              role="alert"
            >
              Код не подошёл или истёк. Попробуйте ещё раз или запросите новый.
            </p>
          ) : null}

          <Button type="submit" size="lg">
            Войти
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Не пришло за минуту?{" "}
          <Link href="/login" className="underline underline-offset-2">
            Отправить ещё раз
          </Link>
          . Код действует 15 минут.
        </p>
      </div>
    </main>
  );
}
