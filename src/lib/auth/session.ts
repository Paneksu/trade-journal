import { cookies } from "next/headers";

import { SESSION_COOKIE, SESSION_MAX_AGE_S, signToken } from "./token";

/* Warstwa ciasteczek. Funkcje czysto kryptograficzne siedza w `token.ts`,
   zeby proxy moglo ich uzywac bez dotykania API zadania. */

export async function setSessionCookie(version: number): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken(version), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function sessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}
