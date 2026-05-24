import { Suspense } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Вход в WB Cleaner</CardTitle>
          <CardDescription>
            Введите email — пришлём ссылку для входа.
          </CardDescription>
        </CardHeader>
        {/* Suspense для useSearchParams в клиентской форме — без него Next
            не может пререндерить /login. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}
