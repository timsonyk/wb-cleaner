"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRules, resetToPreset, type SaveRulesResult } from "./actions";

interface Props {
  accountId: string;
  profileName: string;
  isPreset: boolean;
  initial: {
    minViews: number;
    minCtr: number;
    weakCampaignCtr: number;
    minCartsToProtect: number;
    topKeepPct: number;
    minClustersAlive: number;
    bannedKeywords: string[];
    useDynamicCtr: boolean;
    minDynamicCtr: number;
  };
}

const initial: SaveRulesResult = { status: "idle" };

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function RulesForm(props: Props) {
  const [state, action, pending] = useActionState(saveRules, initial);
  const r = props.initial;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="accountId" value={props.accountId} />

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        Текущий профиль: <b>{props.profileName}</b>{" "}
        {props.isPreset ? (
          <span className="text-muted-foreground">
            (это пресет — при сохранении сделаем твою личную копию)
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Минимум показов для оценки"
          hint="Если у фразы меньше показов — не трогаем, ещё рано решать."
        >
          <Input type="number" name="minViews" defaultValue={r.minViews} min={1} step={1} required />
        </Field>

        <Field
          label="Минимальный CTR, %"
          hint="Если CTR ниже и нет корзин — фразу заминусуем."
        >
          <Input type="number" name="minCtr" defaultValue={r.minCtr} step="0.1" min={0} required />
        </Field>

        <Field
          label="«Слабая кампания» — медиана CTR ниже, %"
          hint="Если медиана низкая — кампания считается слабой, и мы спасаем топ."
        >
          <Input
            type="number"
            name="weakCampaignCtr"
            defaultValue={r.weakCampaignCtr}
            step="0.1"
            min={0}
            required
          />
        </Field>

        <Field
          label="Корзин для защиты"
          hint="Сколько корзин достаточно, чтобы фразу НЕ минусовать."
        >
          <Input
            type="number"
            name="minCartsToProtect"
            defaultValue={r.minCartsToProtect}
            step={1}
            min={0}
            required
          />
        </Field>

        <Field
          label="Топ слабой кампании, доля"
          hint="0.20 = в слабой РК оставим топ-20% по CTR."
        >
          <Input
            type="number"
            name="topKeepPct"
            defaultValue={r.topKeepPct}
            step="0.05"
            min={0}
            max={1}
            required
          />
        </Field>

        <Field
          label="Гарантия минимума кластеров"
          hint="В кампании всегда должно остаться не меньше этого числа кластеров."
        >
          <Input
            type="number"
            name="minClustersAlive"
            defaultValue={r.minClustersAlive}
            step={1}
            min={1}
            required
          />
        </Field>
      </div>

      <Field
        label="Запрещённые слова (банлист)"
        hint='Каждое — с новой строки или через запятую. Дефолт: «dite».'
      >
        <textarea
          name="bannedKeywords"
          defaultValue={r.bannedKeywords.join("\n")}
          className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          spellCheck={false}
        />
      </Field>

      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Продвинутое: динамический порог CTR
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="useDynamicCtr"
              defaultChecked={r.useDynamicCtr}
              className="size-4"
            />
            Включить динамический порог
          </label>
          <Field
            label="Минимальный CTR при динамике, %"
            hint="Нижняя граница динамического порога — даже если медиана падает."
          >
            <Input
              type="number"
              name="minDynamicCtr"
              defaultValue={r.minDynamicCtr}
              step="0.1"
              min={0}
              required
            />
          </Field>
        </div>
      </details>

      {state.status === "error" ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state.status === "ok" ? (
        <p className="text-sm text-emerald-700">{state.message}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/accounts">← К аккаунтам</Link>
        </Button>
        <div className="flex items-center gap-2">
          {!props.isPreset ? (
            <form action={resetToPreset}>
              <input type="hidden" name="accountId" value={props.accountId} />
              <Button type="submit" variant="outline" size="sm">
                Сбросить на «Одежда»
              </Button>
            </form>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </form>
  );
}
