import { requireUser } from "@/lib/auth/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewAccountForm } from "./new-form";

export default async function NewAccountPage() {
  await requireUser();
  return (
    <div className="flex items-start justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Подключить WB-аккаунт</CardTitle>
          <CardDescription>
            Имя для удобства и JWT-токен из{" "}
            <a
              href="https://seller.wildberries.ru/supplier-settings/access-to-api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              кабинета продавца
            </a>
            . Нужны категории: «Реклама», «Контент».
            Токен зашифрован при сохранении (AES-256-GCM).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}
