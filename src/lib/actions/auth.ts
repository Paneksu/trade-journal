"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { checkPasswordStrength, hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import {
  checkRateLimit,
  clearAttempts,
  getSettings,
  recordFailedAttempt,
  requireSession,
} from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export type SignInState = { error?: string };

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "lokalny";
}

export async function signIn(_p: SignInState, data: FormData): Promise<SignInState> {
  const key = await clientKey();
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    return { error: `Za duzo prob. Sprobuj ponownie za ${Math.ceil(limit.retryInS / 60)} min.` };
  }

  const password = String(data.get("haslo") ?? "");
  const s = await getSettings();

  if (!(await verifyPassword(password, s.passwordHash))) {
    recordFailedAttempt(key);
    return { error: "Nieprawidlowe haslo." };
  }

  clearAttempts(key);
  await setSessionCookie(s.sessionVersion);

  const back = String(data.get("wroc") ?? "");
  // Przekierowanie tylko w obrebie aplikacji - inaczej byloby to otwarte przekierowanie.
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export type PasswordState = { ok?: boolean; error?: string };

export async function changePassword(_p: PasswordState, data: FormData): Promise<PasswordState> {
  const s = await requireSession();

  const current = String(data.get("obecne") ?? "");
  const next = String(data.get("nowe") ?? "");
  const repeated = String(data.get("powtorzone") ?? "");

  if (!(await verifyPassword(current, s.passwordHash))) {
    return { error: "Obecne haslo sie nie zgadza." };
  }
  if (next !== repeated) return { error: "Nowe hasla nie sa takie same." };

  const strength = checkPasswordStrength(next);
  if (!strength.ok) return { error: strength.reason };

  // Podbicie wersji sesji uniewaznia wszystkie stare ciasteczka, takze te
  // z innych urzadzen. Biezaca sesje odnawiamy od razu.
  await db
    .update(settings)
    .set({
      passwordHash: await hashPassword(next),
      sessionVersion: s.sessionVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await setSessionCookie(s.sessionVersion + 1);
  revalidatePath("/", "layout");
  return { ok: true };
}
