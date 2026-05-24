"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { revertDecision, type RevertResult } from "./actions";

const initial: RevertResult = { ok: false, message: "" };

export function RevertButton({ decisionId }: { decisionId: string }) {
  const [state, action, pending] = useActionState(revertDecision, initial);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="decisionId" value={decisionId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Восстанавливаем…" : "Восстановить"}
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
