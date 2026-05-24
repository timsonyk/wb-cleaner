import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function VerifyRequestPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Проверьте почту</CardTitle>
          <CardDescription>
            Мы отправили ссылку для входа на ваш email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ссылка действует 15 минут. Если письмо не пришло — проверьте
            спам или попробуйте снова.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
