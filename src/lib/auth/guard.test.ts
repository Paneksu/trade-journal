import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `guard.ts` importuje bazy i `next/navigation` na potrzeby straży stron; tu testujemy tylko licznik. */
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { checkRateLimit, clearAttempts, recordFailedAttempt } from "./guard";

const MIN = 60_000;
const KLUCZ = "test:guard";

function wyczerpLimit(klucz = KLUCZ, limit?: number) {
  const n = limit ?? 8;
  for (let i = 0; i < n; i++) recordFailedAttempt(klucz, limit);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  clearAttempts(KLUCZ);
});
afterEach(() => {
  clearAttempts(KLUCZ);
  vi.useRealTimers();
});

describe("blokada prob", () => {
  it("7 bledow jeszcze przepuszcza, 8. blokuje na 10 minut", () => {
    for (let i = 0; i < 7; i++) recordFailedAttempt(KLUCZ);
    expect(checkRateLimit(KLUCZ).allowed).toBe(true);
    recordFailedAttempt(KLUCZ);
    const wynik = checkRateLimit(KLUCZ);
    expect(wynik.allowed).toBe(false);
    expect(wynik.retryInS).toBe(600);
  });

  it("po uplywie blokady licznik startuje od zera", () => {
    wyczerpLimit();
    vi.advanceTimersByTime(10 * MIN + 1000);
    expect(checkRateLimit(KLUCZ).allowed).toBe(true);
    for (let i = 0; i < 7; i++) recordFailedAttempt(KLUCZ);
    expect(checkRateLimit(KLUCZ).allowed).toBe(true);
  });

  it("wlasny limit (globalny licznik 2FA) dziala niezaleznie od domyslnego", () => {
    for (let i = 0; i < 29; i++) recordFailedAttempt(KLUCZ, 30);
    expect(checkRateLimit(KLUCZ, 30).allowed).toBe(true);
    recordFailedAttempt(KLUCZ, 30);
    expect(checkRateLimit(KLUCZ, 30).allowed).toBe(false);
  });
});

describe("eskalacja: kazda kolejna blokada trwa dwa razy dluzej", () => {
  it("10 min, potem 20, potem 40", () => {
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(10 * 60);

    vi.advanceTimersByTime(10 * MIN + 1000);
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(20 * 60);

    vi.advanceTimersByTime(20 * MIN + 1000);
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(40 * 60);
  });

  it("wydluzona blokada nie skraca sie kolejnym wpisem z rownoleglego zapytania", () => {
    wyczerpLimit();
    vi.advanceTimersByTime(10 * MIN + 1000);
    wyczerpLimit();
    recordFailedAttempt(KLUCZ);
    expect(checkRateLimit(KLUCZ).retryInS).toBeGreaterThan(19 * 60);
  });

  it("blokada nie przekracza 12 godzin", () => {
    for (let i = 0; i < 12; i++) {
      wyczerpLimit();
      vi.advanceTimersByTime(13 * 60 * MIN);
    }
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBeLessThanOrEqual(12 * 60 * 60);
  });

  it("seria zanika po dobie bez blokad", () => {
    wyczerpLimit();
    vi.advanceTimersByTime(10 * MIN + 1000);
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(20 * 60);
    vi.advanceTimersByTime(25 * 60 * MIN);
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(10 * 60);
  });

  it("udane logowanie zeruje takze serie", () => {
    wyczerpLimit();
    vi.advanceTimersByTime(10 * MIN + 1000);
    wyczerpLimit();
    clearAttempts(KLUCZ);
    wyczerpLimit();
    expect(checkRateLimit(KLUCZ).retryInS).toBe(10 * 60);
  });

  it("globalny licznik 2FA: 30 bledow z roznych adresow to 10 min, potem 20 min", () => {
    wyczerpLimit(KLUCZ, 30);
    expect(checkRateLimit(KLUCZ, 30).retryInS).toBe(10 * 60);
    vi.advanceTimersByTime(10 * MIN + 1000);
    wyczerpLimit(KLUCZ, 30);
    expect(checkRateLimit(KLUCZ, 30).retryInS).toBe(20 * 60);
  });
});
