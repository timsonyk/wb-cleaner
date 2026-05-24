"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAccount, type AddAccountState } from "../actions";

const initial: AddAccountState = { status: "idle" };

export function NewAccountForm() {
  const [state, formAction, pending] = useActionState(addAccount, initial);
  const error = state.status === "error" ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="name">
          Имя аккаунта
        </label>
        <Input
          id="name"
          name="name"
          placeholder="Магазин 1"
          required
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="token">
          JWT-токен
        </label>
        <textarea
          id="token"
          name="token"
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring"
          placeholder="eyJhbGciOi…"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <p className="text-xs text-muted-foreground">
          Токен виден только при вводе — после отправки он шифруется и в БД
          лежит как ciphertext. В логи никогда не попадёт.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Проверяем токен…" : "Подключить"}
      </Button>
    </form>
  );
}
