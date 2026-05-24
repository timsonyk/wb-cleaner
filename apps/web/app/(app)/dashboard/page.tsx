import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wbAccounts, runs } from "@/lib/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/require-user";

type LastRunRow = {
  accountId: string;
  accountName: string;
  mode: "preview" | "auto";
  runId: string | null;
  status: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: Record<string, unknown> | null;
  [key: string]: unknown;
};

function formatRunTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summaryInt(s: Record<string, unknown> | null, key: string): number {
  if (!s) return 0;
  const v = s[key];
  return typeof v === "number" ? v : 0;
}

export default async function DashboardPage() {
  const { userId, email } = await requireUser();

  // По одному последнему run на каждый аккаунт юзера через LATERAL JOIN.
  const rows = (await db.execute<LastRunRow>(sql`
    SELECT
      a.id                AS "accountId",
      a.name              AS "accountName",
      a.mode              AS "mode",
      r.id::text          AS "runId",
      r.status::text      AS "status",
      r.started_at        AS "startedAt",
      r.finished_at       AS "finishedAt",
      r.summary           AS "summary"
    FROM ${wbAccounts} a
    LEFT JOIN LATERAL (
      SELECT *
        FROM ${runs} rr
       WHERE rr.wb_account_id = a.id
       ORDER BY rr.started_at DESC
       LIMIT 1
    ) r ON true
    WHERE a.user_id = ${userId}
    ORDER BY a.created_at DESC
  `)) as unknown as LastRunRow[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Дашборд</h1>
        <p className="text-sm text-muted-foreground">
          Последние прогоны воркера. Аккаунт: {email}.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Пока нет WB-аккаунтов</CardTitle>
            <CardDescription>
              Подключи первый — и здесь появится статистика прогонов.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/accounts/new">Подключить аккаунт</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const hasRun = !!r.runId;
            const isPreview = r.mode === "preview";
            return (
              <Card key={r.accountId}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="truncate">{r.accountName}</CardTitle>
                    <span
                      className={
                        "rounded-md px-2 py-0.5 text-xs " +
                        (isPreview
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800")
                      }
                    >
                      {r.mode}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {!hasRun ? (
                    <p className="text-muted-foreground">
                      Прогонов ещё не было. Воркер запустится по cron, либо
                      командой <code className="rounded bg-muted px-1">python -m apps.worker.cli</code>.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Последний:</span>
                        <span>{formatRunTime(r.startedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Статус:</span>
                        <span>{r.status}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Решений (exclude):</span>
                        <span>{summaryInt(r.summary, "decisionsExclude")}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Применено в WB:</span>
                        <span>{summaryInt(r.summary, "applied")}</span>
                      </div>
                    </>
                  )}
                </CardContent>
                <CardFooter>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={{
                        pathname: "/decisions",
                        query: { account: r.accountId },
                      }}
                    >
                      Все решения
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
