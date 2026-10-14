import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";
import { SESSION_COOKIE, signToken } from "@/lib/auth/token";

/*
 * Proxy przy SameSite=Strict (ADR-031): wejscie z zewnetrznego linku (Gmail, TradingView)
 * nie niesie ciasteczka sesji. Brak ciasteczka nie moze kasowac sesji w przegladarce, bo to
 * wylogowaloby uzytkownika zamiast pozwolic mu kliknac jeszcze raz.
 */

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
});

function zadanie(sciezka: string, naglowki: Record<string, string> = {}, ciasteczko?: string) {
  const h = new Headers(naglowki);
  if (ciasteczko !== undefined) h.set("cookie", `${SESSION_COOKIE}=${ciasteczko}`);
  return new NextRequest(`https://dziennik.panekweb.pl${sciezka}`, { headers: h });
}

const KASUJE = (r: Response) => (r.headers.get("set-cookie") ?? "").includes(`${SESSION_COOKIE}=;`);

describe("proxy: kasowanie ciasteczka sesji", () => {
  it("wejscie z linku zewnetrznego (cross-site, bez ciasteczka) przekierowuje na logowanie i NIE kasuje sesji", () => {
    const r = proxy(
      zadanie("/trades?status=open", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }),
    );
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(r.headers.get("location")!).searchParams.get("wroc")).toBe("/trades?status=open");
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("zwykle wejscie bez ciasteczka tez niczego nie kasuje", () => {
    expect(proxy(zadanie("/stats")).headers.get("set-cookie")).toBeNull();
  });

  it("niewazne ciasteczko (zly podpis, wygasle) jest kasowane", () => {
    expect(KASUJE(proxy(zadanie("/stats", {}, "1.9999999999999.zlypodpis")))).toBe(true);
    expect(KASUJE(proxy(zadanie("/stats", {}, signToken(1, Date.now() - 1000))))).toBe(true);
  });

  it("wazne ciasteczko przechodzi bez przekierowania i bez kasowania", () => {
    const r = proxy(zadanie("/stats", {}, signToken(1)));
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
