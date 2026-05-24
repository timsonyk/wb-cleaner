"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { runNow, type RunNowResult } from "./actions";

const initial: RunNowResult = { ok: false, message: "" };

export function RunNowButton({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(runNow, initial);
  return (
    <form action={action} className="flex flex-col items-stretch gap-1">
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Запускаем…" : "Запустить сейчас"}
      </Button>
      {state.message ? (
        <p
          className={
            "text-xs " + (state.ok ? "text-emerald-700" : "text-destructive")
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
