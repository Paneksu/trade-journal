import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Blokada prob i tryb sudo (ADR-031) bez bazy: `next/headers` jest atrapa, a
 * liczniki to prawdziwy kod z guard.ts.
 */

const stan = vi.hoisted(() => ({
  naglowki: new Headers(),
  ciasteczka: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => stan.naglowki,
  cookies: async () => ({
    get: (nazwa: string) => (stan.ciasteczka.has(nazwa) ? { value: stan.ciasteczka.get(nazwa) } : undefined),
    set: (nazwa: string, wartosc: string) => void stan.ciasteczka.set(nazwa, wartosc),
    delete: (nazwa: string) => void stan.ciasteczka.delete(nazwa),
  }),
}));
vi.mock("@/lib/auth/second-factor", () => ({ zapiszZdarzenie: async () => {} }));

import { clearAttempts } from "./guard";
import { setSudoCookie } from "./session";
import {
  KLUCZ_GLOBALNY_2FA,
  sprawdzBlokade,
  stanSudo,
  wyczyscBlokade,
  zapiszNiepowodzenie,
} from "./zadanie";

function jakoKlient(xff: string | null) {
  stan.naglowki = new Headers(xff ? { "x-forwarded-for": xff } : {});
}

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
});

beforeEach(() => {
  stan.ciasteczka.clear();
  clearAttempts(KLUCZ_GLOBALNY_2FA);
  for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) clearAttempts(ip);
});

describe("blokada po 8 bledach obejmuje kod TOTP", () => {
  it("osiem bledow (haslo i kody razem) blokuje, siodmy jeszcze nie", async () => {
    jakoKlient("10.0.0.1");
    for (let i = 0; i < 4; i++) await zapiszNiepowodzenie(false); // bledne hasla
    for (let i = 0; i < 3; i++) await zapiszNiepowodzenie(true); // bledne kody
    expect((await sprawdzBlokade(true)).zablokowany).toBe(false);
    await zapiszNiepowodzenie(true);
    const wynik = await sprawdzBlokade(true);
    expect(wynik.zablokowany).toBe(true);
    // Zablokowane jest tez samo haslo: to jeden licznik.
    expect((await sprawdzBlokade(false)).zablokowany).toBe(true);
  });

  it("komunikat mowi, na ile minut", async () => {
    jakoKlient("10.0.0.1");
    for (let i = 0; i < 8; i++) await zapiszNiepowodzenie(true);
    const wynik = await sprawdzBlokade(true);
    expect(wynik).toMatchObject({ zablokowany: true });
    expect(wynik.zablokowany && wynik.komunikat).toMatch(/Spróbuj ponownie za \d+ min/);
  });

  it("inny adres nie jest zablokowany", async () => {
    jakoKlient("10.0.0.1");
    for (let i = 0; i < 8; i++) await zapiszNiepowodzenie(true);
    jakoKlient("10.0.0.2");
    expect((await sprawdzBlokade(true)).zablokowany).toBe(false);
  });

  it("podstawiony poczatek X-Forwarded-For nie daje swiezego licznika (liczy sie ostatni wpis od proxy)", async () => {
    for (let i = 0; i < 8; i++) {
      jakoKlient(`${i}.${i}.${i}.${i}, 10.0.0.1`);
      await zapiszNiepowodzenie(false);
    }
    jakoKlient("evil, 8.8.8.8, 10.0.0.1");
    expect((await sprawdzBlokade(false)).zablokowany).toBe(true);
  });

  it("poprawne logowanie zeruje licznik adresu", async () => {
    jakoKlient("10.0.0.1");
    for (let i = 0; i < 7; i++) await zapiszNiepowodzenie(false);
    await wyczyscBlokade();
    for (let i = 0; i < 7; i++) await zapiszNiepowodzenie(false);
    expect((await sprawdzBlokade(false)).zablokowany).toBe(false);
  });

  it("globalny licznik drugiego skladnika blokuje zgadywanie kodu z wielu adresow (30 prob)", async () => {
    for (let i = 0; i < 30; i++) {
      jakoKlient(`10.1.${Math.floor(i / 200)}.${i}`); // 30 roznych adresow, kazdy z jedna proba
      await zapiszNiepowodzenie(true);
    }
    jakoKlient("10.0.0.3");
    expect((await sprawdzBlokade(true)).zablokowany).toBe(true);
    // Samo haslo (bez drugiego skladnika) nie jest przez to blokowane.
    expect((await sprawdzBlokade(false)).zablokowany).toBe(false);
  });
});

describe("stan trybu sudo", () => {
  const wlaczone = { totpEnabledAt: new Date(), sessionVersion: 3 };

  it("bez 2FA sudo nie dotyczy", async () => {
    expect(await stanSudo({ totpEnabledAt: null, sessionVersion: 3 })).toEqual({ stan: "nie_dotyczy" });
  });

  it("z 2FA bez ciasteczka sudo jest wymagane", async () => {
    expect(await stanSudo(wlaczone)).toEqual({ stan: "wymagany" });
  });

  it("z waznym ciasteczkiem jest aktywne, i to na ok. 10 minut", async () => {
    await setSudoCookie(3);
    const s = await stanSudo(wlaczone);
    expect(s.stan).toBe("aktywny");
    if (s.stan === "aktywny") {
      const zostalo = s.doKiedy - Date.now();
      expect(zostalo).toBeGreaterThan(9 * 60_000);
      expect(zostalo).toBeLessThanOrEqual(10 * 60_000);
    }
  });

  it("podbicie wersji sesji (zmiana hasla, wylaczenie 2FA, wyloguj wszedzie) konczy sudo", async () => {
    await setSudoCookie(3);
    expect(await stanSudo({ ...wlaczone, sessionVersion: 4 })).toEqual({ stan: "wymagany" });
  });

  it("podrobione ciasteczko sudo nie daje trybu sudo", async () => {
    stan.ciasteczka.set("tj_sudo", `3.${Date.now() + 600_000}.AAAA`);
    expect(await stanSudo(wlaczone)).toEqual({ stan: "wymagany" });
  });
});
