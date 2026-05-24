import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { wbAccounts } from "@/lib/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/require-user";

export default async function SettingsPage() {
  const { userId, email } = await requireUser();

  const accounts = await db
    .select({ id: wbAccounts.id, name: wbAccounts.name, mode: wbAccounts.mode })
    .from(wbAccounts)
    .where(eq(wbAccounts.userId, userId))
    .orderBy(wbAccounts.createdAt);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Аккаунт <b>{email}</b>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>WB-аккаунты</CardTitle>
          <CardDescription>
            Подключённые продавцы Wildberries. Обычно достаточно одного.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока не подключено ни одного аккаунта.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    <b>{a.name}</b>{" "}
                    <span className="text-muted-foreground">· {a.mode}</span>
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/accounts/${a.id}/rules`}>Правила</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/accounts">Управление аккаунтами</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/accounts/new">Подключить ещё один</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Правила чистки</CardTitle>
          <CardDescription>
            У каждого WB-аккаунта свои правила: минимальный CTR, банлист и
            прочее. Можно менять — оригинальные пресеты не пострадают.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Сначала подключи WB-аккаунт — после этого появится возможность
              настроить правила.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/accounts/${a.id}/rules`}
                    className="underline hover:text-foreground"
                  >
                    Правила для «{a.name}»
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
