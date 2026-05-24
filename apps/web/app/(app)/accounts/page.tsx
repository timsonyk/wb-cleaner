import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wbAccounts } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">WB-аккаунты</h1>
          <p className="text-sm text-muted-foreground">
            Подключённые продавцы и режим работы.
          </p>
        </div>
        <Button asChild>
          <Link href="/accounts/new">Добавить аккаунт</Link>
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Нет подключённых аккаунтов</CardTitle>
            <CardDescription>
              Добавь первый — система запустится в preview-режиме на 7 дней,
              ничего не будет реально минусоваться, только покажет что
              сделала бы.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/accounts/new">Добавить аккаунт</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
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
              <Card
                key={a.id}
                className={isNew ? "ring-2 ring-ring" : undefined}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{a.name}</CardTitle>
                      <CardDescription>
                        Подключён {a.createdAt.toLocaleDateString("ru-RU")}
                      </CardDescription>
                    </div>
                    <span
                      className={
                        "rounded-md px-2 py-0.5 text-xs " +
                        (isPreview
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800")
                      }
                    >
                      {isPreview
                        ? `preview${previewLeftDays !== null ? ` · ${previewLeftDays}д` : ""}`
                        : "auto"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-sm">
                  {a.validationError ? (
                    <p className="text-destructive">
                      Ошибка валидации: {a.validationError}
                    </p>
                  ) : a.lastValidatedAt ? (
                    <p className="text-muted-foreground">
                      Токен проверен{" "}
                      {a.lastValidatedAt.toLocaleDateString("ru-RU")}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">Токен не проверялся</p>
                  )}
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-2">
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/accounts/${a.id}/rules`}>
                        Правила чистки
                      </Link>
                    </Button>
                    <DeleteAccountButton id={a.id} name={a.name} />
                  </div>
                  <RunNowButton accountId={a.id} />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
