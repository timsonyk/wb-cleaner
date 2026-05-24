"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REASON_CODES, DECISION_ACTIONS } from "@wb-cleaner/shared-types";

interface AccountOpt {
  id: string;
  name: string;
}

export function DecisionFilters({ accounts }: { accounts: AccountOpt[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function update(form: FormData) {
    const next = new URLSearchParams();
    for (const k of ["account", "advert", "nm", "action", "reason", "from", "to"]) {
      const v = form.get(k);
      if (v) next.set(k, String(v).trim());
    }
    start(() => router.push(`/decisions?${next.toString()}`));
  }

  return (
    <form
      action={update}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 items-end"
    >
      <label className="flex flex-col gap-1 text-xs">
        Аккаунт
        <select
          name="account"
          defaultValue={params.get("account") ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">все</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Кампания
        <Input
          name="advert"
          type="number"
          defaultValue={params.get("advert") ?? ""}
          placeholder="advert_id"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Артикул
        <Input
          name="nm"
          type="number"
          defaultValue={params.get("nm") ?? ""}
          placeholder="nm_id"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Действие
        <select
          name="action"
          defaultValue={params.get("action") ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">все</option>
          {DECISION_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Причина
        <select
          name="reason"
          defaultValue={params.get("reason") ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">все</option>
          {REASON_CODES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Дата с
        <Input type="date" name="from" defaultValue={params.get("from") ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Дата по
        <Input type="date" name="to" defaultValue={params.get("to") ?? ""} />
      </label>
      <div className="col-span-2 sm:col-span-4 lg:col-span-7 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Применить
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => start(() => router.push("/decisions"))}
        >
          Сбросить
        </Button>
      </div>
    </form>
  );
}
