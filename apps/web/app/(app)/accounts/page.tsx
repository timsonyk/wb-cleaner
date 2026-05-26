import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wbAccounts } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/require-user";
import { DeleteAccountButton } from "./delete-button";
import { RunNowButton } from "./run-now-button";

interface PageProps {
  searchParams: Promise<{ new?: string }>;
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const { userId } = await requireUser();
  const { new: newId } = await searchParams;

  const accounts = await db
    .select({
      id: wbAccounts.id,
      name: wbAccounts.name,
      mode: wbAccounts.mode,
      previewUntil: wbAccounts.previewUntil,
      lastValidatedAt: wbAccounts.lastValidatedAt,
      validationError: wbAccounts.validationError,
      createdAt: wbAccounts.createdAt,
      isActive: wbAccounts.isActive,
    })
    .from(wbAccounts)
    .where(eq(wbAccounts.userId, userId))
    .orderBy(desc(wbAccounts.createdAt));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WB-аккаунты</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Подключённые продавцы и их режим работы.
          </p>
        </div>
        {accounts.length > 0 ? (
          <Button asChild>
            <Link href="/accounts/new">+ Добавить</Link>
          </Button>
        ) : null}
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <h2 className="text-lg font-medium">Пока ни одного аккаунта</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Подключите первый — программа 7 дней понаблюдает в preview-режиме,
            ничего не минусуя в WB, и покажет что бы она сделала.
          </p>
          <div className="mt-6">
            <Button asChild size="lg">
              <Link href="/accounts/new">Подключить аккаунт</Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => {
            const isNew = a.id === newId;
            const isPreview = a.mode === "preview";
            const previewLeftDays =
              a.previewUntil && isPreview
                ? Math.max(
                    0,
                    Math.ceil(
                      (a.previewUntil.getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  )
                : null;
            return (
              <li
                key={a.id}
                className={
                  "rounded-lg border bg-card transition " +
                  (isNew ? "ring-2 ring-foreground/40" : "")
                }
              >
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="truncate text-lg font-medium">
                        {a.name}
                      </h3>
                      <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {isPreview ? "preview" : "auto"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Подключён {a.createdAt.toLocaleDateString("ru-RU")}
                      </span>
                      {isPreview && previewLeftDays !== null ? (
                        <span>
                          Preview ещё {previewLeftDays}{" "}
                          {previewLeftDays === 1 ? "день" : "дн."}
                        </span>
                      ) : null}
                      {a.validationError ? (
                        <span className="text-foreground">
                          Ошибка валидации: {a.validationError}
                        </span>
                      ) : a.lastValidatedAt ? (
                        <span>
                          Токен проверен{" "}
                          {a.lastValidatedAt.toLocaleDateString("ru-RU")}
                        </span>
                      ) : (
                        <span>Токен не проверялся</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <RunNowButton accountId={a.id} />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t px-5 py-2.5 text-xs">
                  <div className="flex items-center gap-4">
                    <Link
                      href={`/accounts/${a.id}/rules`}
                      className="text-muted-foreground transition hover:text-foreground"
                    >
                      Правила чистки
                    </Link>
                    <Link
                      href={{
                        pathname: "/decisions",
                        query: { account: a.id },
                      }}
                      className="text-muted-foreground transition hover:text-foreground"
                    >
                      Журнал решений
                    </Link>
                  </div>
                  <DeleteAccountButton id={a.id} name={a.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
