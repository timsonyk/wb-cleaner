import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { NewAccountForm } from "./new-form";

export default async function NewAccountPage() {
  await requireUser();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/accounts"
          className="text-xs text-muted-foreground transition hover:text-foreground"
        >
          ← Аккаунты
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Подключить WB-аккаунт
        </h1>
        <p className="text-sm text-muted-foreground">
          Имя для удобства и JWT-токен. Токен шифруется при сохранении
          (AES-256-GCM), в логи не попадает.
        </p>
      </header>

      <section className="rounded-lg border bg-muted/30 p-4">
        <h2 className="text-sm font-medium">Что произойдёт после подключения</h2>
        <ol className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="select-none font-mono">01</span>
            <span>
              Проверим токен — один запрос к WB. Если невалиден — увидите ошибку
              и аккаунт не создастся.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="select-none font-mono">02</span>
            <span>
              7 дней — preview-режим: программа всё анализирует и пишет в журнал,
              но <span className="text-foreground">в WB ничего не отправляет</span>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="select-none font-mono">03</span>
            <span>
              После — переключите в auto и программа начнёт чистить ежедневно.
              Любое решение можно откатить.
            </span>
          </li>
        </ol>
      </section>

      <NewAccountForm />

      <aside className="rounded-lg border border-dashed p-4 text-sm">
        <p className="font-medium">Где взять токен</p>
        <p className="mt-1 text-muted-foreground">
          В{" "}
          <a
            href="https://seller.wildberries.ru/supplier-settings/access-to-api"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            кабинете продавца → Настройки → Доступ к API
          </a>
          . Выпустите токен с категориями <b>«Реклама»</b> и <b>«Контент»</b>.
        </p>
      </aside>
    </div>
  );
}
