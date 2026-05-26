import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wbAccounts, runs } from "@/lib/db/schema";
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

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
          <p className="mt-1 text-sm text-muted-foreground">{email}</p>
        </header>
        <div className="rounded-lg border border-dashed py-16 text-center">
          <h2 className="text-lg font-medium">Здесь будут прогоны воркера</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Подключите WB-аккаунт, и на этой странице появится статистика
            последних прогонов и сколько фраз программа выключила.
          </p>
          <div className="mt-6">
            <Button asChild size="lg">
              <Link href="/accounts/new">Подключить аккаунт</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Последние прогоны по каждому аккаунту. {email}.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/accounts">Все аккаунты →</Link>
        </Button>
      </header>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const hasRun = !!r.runId;
          const isPreview = r.mode === "preview";
          return (
            <li key={r.accountId} className="rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-4 border-b p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate text-lg font-medium">
                      {r.accountName}
                    </h3>
                    <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {isPreview ? "preview" : "auto"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Последний прогон: {formatRunTime(r.startedAt)}
                    {r.status ? ` · ${r.status}` : ""}
                  </p>
                </div>
                <Link
                  href={{
                    pathname: "/decisions",
                    query: { account: r.accountId },
                  }}
                  className="text-xs text-muted-foreground transition hover:text-foreground"
                >
                  Все решения →
                </Link>
              </div>

              {!hasRun ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  Прогонов ещё не было. Нажмите «Запустить сейчас» на странице{" "}
                  <Link
                    href="/accounts"
                    className="underline underline-offset-2"
                  >
                    аккаунтов
                  </Link>
                  .
                </p>
              ) : (
                <dl className="grid grid-cols-2 divide-x sm:grid-cols-4">
                  <Stat label="Кластеров" value={summaryInt(r.summary, "clustersAnalyzed")} />
                  <Stat label="Выключить" value={summaryInt(r.summary, "decisionsExclude")} />
                  <Stat label="Оставить" value={summaryInt(r.summary, "decisionsKeep")} />
                  <Stat
                    label={isPreview ? "Было бы применено" : "Применено"}
                    value={
                      isPreview
                        ? summaryInt(r.summary, "decisionsExclude")
                        : summaryInt(r.summary, "applied")
                    }
                    muted={isPreview}
                  />
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          "mt-1 text-2xl font-medium tabular-nums " +
          (muted ? "text-muted-foreground" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}
