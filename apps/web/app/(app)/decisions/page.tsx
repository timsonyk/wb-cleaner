import Link from "next/link";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { decisions, runs, wbAccounts } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/require-user";
import {
  DECISION_ACTIONS,
  REASON_CODES,
} from "@wb-cleaner/shared-types";
import type { DecisionAction, ReasonCode } from "@wb-cleaner/shared-types";
import { reasonLabel } from "@/lib/reasons";
import { DecisionFilters } from "./filters";
import { RevertButton } from "./revert-button";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    account?: string;
    advert?: string;
    nm?: string;
    action?: string;
    reason?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

export default async function DecisionsPage({ searchParams }: PageProps) {
  const { userId } = await requireUser();
  const params = await searchParams;

  const accountsList = await db
    .select({ id: wbAccounts.id, name: wbAccounts.name })
    .from(wbAccounts)
    .where(eq(wbAccounts.userId, userId))
    .orderBy(wbAccounts.name);

  // ── Whitelisted фильтры ──
  const filters = [eq(wbAccounts.userId, userId)];
  if (params.account) filters.push(eq(wbAccounts.id, params.account));
  if (params.advert && /^\d+$/.test(params.advert)) {
    filters.push(eq(decisions.advertId, Number(params.advert)));
  }
  if (params.nm && /^\d+$/.test(params.nm)) {
    filters.push(eq(decisions.nmId, Number(params.nm)));
  }
  if (params.action && DECISION_ACTIONS.includes(params.action as DecisionAction)) {
    filters.push(eq(decisions.action, params.action as DecisionAction));
  }
  if (params.reason && REASON_CODES.includes(params.reason as ReasonCode)) {
    filters.push(eq(decisions.reasonCode, params.reason as ReasonCode));
  }
  if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
    filters.push(gte(runs.startedAt, new Date(params.from)));
  }
  if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    const to = new Date(params.to);
    to.setDate(to.getDate() + 1); // inclusive
    filters.push(lte(runs.startedAt, to));
  }

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // ── Запрос ──
  const rows = await db
    .select({
      id: decisions.id,
      advertId: decisions.advertId,
      nmId: decisions.nmId,
      normQuery: decisions.normQuery,
      action: decisions.action,
      reasonCode: decisions.reasonCode,
      ctr: decisions.ctr,
      views: decisions.views,
      clicks: decisions.clicks,
      carts: decisions.carts,
      orders: decisions.orders,
      wasApplied: decisions.wasApplied,
      revertedAt: decisions.revertedAt,
      runStartedAt: runs.startedAt,
      accountName: wbAccounts.name,
    })
    .from(decisions)
    .innerJoin(runs, eq(runs.id, decisions.runId))
    .innerJoin(wbAccounts, eq(wbAccounts.id, runs.wbAccountId))
    .where(and(...filters))
    .orderBy(desc(runs.startedAt), desc(decisions.id))
    .limit(PAGE_SIZE + 1) // +1 чтобы понять, есть ли следующая страница
    .offset(offset);

  const hasMore = rows.length > PAGE_SIZE;
  const view = rows.slice(0, PAGE_SIZE);

  function pageHref(targetPage: number) {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "page") query[k] = v;
    }
    if (targetPage > 1) query.page = String(targetPage);
    return { pathname: "/decisions" as const, query };
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Решения</h1>
        <p className="text-sm text-muted-foreground">
          Каждое решение воркера со ссылкой на причину. Откатить можно только
          те, что были фактически применены в WB.
        </p>
      </div>

      <Card className="p-3">
        <DecisionFilters accounts={accountsList} />
      </Card>

      {view.length === 0 ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Нет решений по заданным фильтрам.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Аккаунт</th>
                <th className="px-3 py-2">Кампания / артикул</th>
                <th className="px-3 py-2">Фраза</th>
                <th className="px-3 py-2">Действие</th>
                <th className="px-3 py-2">Метрики</th>
                <th className="px-3 py-2">Причина</th>
                <th className="px-3 py-2 text-right">Откат</th>
              </tr>
            </thead>
            <tbody>
              {view.map((d) => {
                const isApplied = d.wasApplied;
                const isReverted = !!d.revertedAt;
                const canRevert = d.action === "exclude" && isApplied && !isReverted;
                return (
                  <tr
                    key={d.id}
                    className="border-t border-border/60 align-top"
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {d.runStartedAt.toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2">{d.accountName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-mono text-xs">
                        {String(d.advertId)} · {String(d.nmId)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{d.normQuery}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-md px-2 py-0.5 text-xs " +
                          (d.action === "exclude"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-100 text-slate-700")
                        }
                      >
                        {d.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      <div>
                        v={d.views ?? "—"} · clicks={d.clicks ?? "—"}
                      </div>
                      <div className="text-muted-foreground">
                        CTR={d.ctr != null ? d.ctr.toFixed(2) + "%" : "—"} ·
                        корз={d.carts ?? 0} · зак={d.orders ?? 0}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {reasonLabel(d.reasonCode)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isReverted ? (
                        <span className="text-xs text-muted-foreground">
                          откачено{" "}
                          {d.revertedAt!.toLocaleDateString("ru-RU")}
                        </span>
                      ) : canRevert ? (
                        <RevertButton decisionId={d.id} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-end gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>← Назад</Link>
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">стр. {page}</span>
          {hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>Вперёд →</Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
