"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";

export function LogoutButton() {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(() => signOutAction(fd))}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Выход…" : "Выйти"}
      </Button>
    </form>
  );
}
