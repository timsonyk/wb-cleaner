"use server";

import { signOut } from "@/auth";

export async function signOutAction(_fd: FormData) {
  await signOut({ redirectTo: "/" });
}
