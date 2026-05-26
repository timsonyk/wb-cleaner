import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight hover:underline"
          >
            WB Cleaner
          </Link>
          <h1 className="text-xl font-medium">Вход</h1>
          <p className="text-sm text-muted-foreground">
            Введите email — пришлём magic-link.
          </p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
