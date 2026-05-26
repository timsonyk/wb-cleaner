"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startLogin, type LoginState } from "./actions";

const initialState: LoginState = { ok: false };

export function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const [state, formAction, pending] = useActionState(startLogin, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Input
        type="email"
        name="email"
        placeholder="you@example.com"
        autoComplete="email"
        required
        aria-invalid={!!state.error}
      />
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {state.error ? (
        <p
          className="rounded-md border border-foreground/20 bg-muted/30 px-3 py-2 text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Отправляем…" : "Получить ссылку"}
      </Button>
    </form>
  );
}
