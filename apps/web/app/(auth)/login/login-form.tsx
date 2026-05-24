"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardContent, CardFooter } from "@/components/ui/card";
import { startLogin, type LoginState } from "./actions";

const initialState: LoginState = { ok: false };

export function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const [state, formAction, pending] = useActionState(startLogin, initialState);

  return (
    <form action={formAction}>
      <CardContent className="flex flex-col gap-3">
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
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Отправляем…" : "Получить ссылку"}
        </Button>
      </CardFooter>
    </form>
  );
}
