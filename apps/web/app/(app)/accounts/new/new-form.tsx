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
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
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
        <p className="text-xs text-muted-foreground">
          Только для вас — отображается в списке и журнале решений.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="token">
          JWT-токен
        </label>
        <textarea
          id="token"
          name="token"
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="eyJhbGciOi…"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <p className="text-xs text-muted-foreground">
          Виден только при вводе. После отправки — зашифрован и хранится как
          ciphertext.
        </p>
      </div>

      {error ? (
        <p
          className="rounded-md border border-foreground/20 bg-muted/30 px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-6">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Проверяем токен…" : "Подключить в preview-режиме"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Реальных изменений в WB первые 7 дней не будет.
        </p>
      </div>
    </form>
  );
}
