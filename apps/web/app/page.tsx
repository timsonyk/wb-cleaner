import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-stretch gap-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">WB Cleaner</h1>
          <p className="text-sm text-muted-foreground">
            Автоматическая чистка рекламных кампаний Wildberries.
            Слабые поисковые кластеры — в минус-фразы, без вашего участия.
          </p>
        </div>

        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3">
            <span className="mt-0.5 select-none font-mono text-muted-foreground">
              01
            </span>
            <span>
              Подключаете JWT-токен — токен шифруется в БД, в логи не попадает.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 select-none font-mono text-muted-foreground">
              02
            </span>
            <span>
              7 дней программа наблюдает и показывает что бы она сделала.
              Реальных минусов в WB не отправляется.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 select-none font-mono text-muted-foreground">
              03
            </span>
            <span>
              Переключаете в авто-режим — программа сама чистит каждый день,
              решения пишутся в журнал, любое можно откатить.
            </span>
          </li>
        </ul>

        <div className="flex flex-col gap-2">
          <Button asChild size="lg">
            <Link href="/login">Начать</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Вход по email — без пароля, magic-link.
          </p>
        </div>
      </div>
    </main>
  );
}
