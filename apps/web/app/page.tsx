import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-12">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">WB Cleaner</h1>
        <p className="text-sm text-muted-foreground">
          Авточистка рекламных кампаний Wildberries.
        </p>
      </div>
      <Button asChild>
        <Link href="/login">Войти</Link>
      </Button>
    </main>
  );
}
