import { cookies, headers } from "next/headers";

import { SESSION_COOKIE, SESSION_MAX_AGE_S, signToken } from "./token";

/* Warstwa ciasteczek. Funkcje czysto kryptograficzne siedza w `token.ts`,
   zeby proxy moglo ich uzywac bez dotykania API zadania. */

/**
 * Czy polaczenie idzie po HTTPS. Aplikacja stoi za odwrotnym proxy (Traefik
 * w Coolify), wiec o protokole decyduje naglowek od proxy, a nie to, ze sam
 * kontener obsluguje zwykly HTTP.
 */
async function isHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
}

export async function setSessionCookie(version: number): Promise<void> {
  const jar = await cookies();
  /*
   * `secure` ustawiamy tylko przy HTTPS. Gdyby bylo zawsze wlaczone na
   * produkcji, logowanie pod adresem http (np. domena testowa z Coolify)
   * milczaco by nie dzialalo: serwer odsylalby ciasteczko, a przegladarka
   * odmawialaby jego zapisania.
   */
  jar.set(SESSION_COOKIE, signToken(version), {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
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
