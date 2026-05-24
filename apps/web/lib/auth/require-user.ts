import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Возвращает {userId, email} либо редиректит на /login. Использовать в RSC
 * и server actions, чтобы не таскать null-чек везде. */
export async function requireUser(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) {
    redirect("/login");
  }
  return { userId, email };
}
