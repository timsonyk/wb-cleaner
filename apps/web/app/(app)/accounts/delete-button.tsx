"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteAccount } from "./actions";

export function DeleteAccountButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) => {
        if (!confirm(`Удалить аккаунт «${name}»? Все его прогоны и решения тоже удалятся.`)) {
          return;
        }
        start(() => deleteAccount(fd));
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Удаляем…" : "Удалить"}
      </Button>
    </form>
  );
}
