import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./logout-button";

const NAV = [
  { href: "/dashboard" as const, label: "Дашборд" },
  { href: "/accounts" as const, label: "Аккаунты" },
  { href: "/decisions" as const, label: "Решения" },
  { href: "/settings" as const, label: "Настройки" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            WB Cleaner
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground transition hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{session.user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
