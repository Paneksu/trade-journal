import { beforeAll, describe, expect, it } from "vitest";

import {
  readScoped,
  readToken,
  signScoped,
  signToken,
  verifyToken,
} from "./token";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123456";
});

describe("tokeny o ograniczonym przeznaczeniu (drugi krok, sudo)", () => {
  const T = 1_800_000_000_000;

  it("token drugiego kroku wraca z wersja sesji i terminem", () => {
    const token = signScoped("2fa", 7, 300, T);
    expect(readScoped("2fa", token, T + 1000)).toEqual({ version: 7, expiresAt: T + 300_000 });
  });

  it("wygasa: 5 min dla drugiego kroku, 10 min dla sudo", () => {
    const krok = signScoped("2fa", 1, 5 * 60, T);
    expect(readScoped("2fa", krok, T + 5 * 60_000 - 1)).not.toBeNull();
    expect(readScoped("2fa", krok, T + 5 * 60_000 + 1)).toBeNull();
    const sudo = signScoped("sudo", 1, 10 * 60, T);
    expect(readScoped("sudo", sudo, T + 10 * 60_000 - 1)).not.toBeNull();
    expect(readScoped("sudo", sudo, T + 10 * 60_000 + 1)).toBeNull();
  });

  it("token drugiego kroku NIE jest wazna sesja ani tokenem sudo (rozne przeznaczenie)", () => {
    const krok = signScoped("2fa", 1, 300);
    expect(readToken(krok)).toBeNull();
    expect(verifyToken(krok, 1)).toBe(false);
    expect(readScoped("sudo", krok)).toBeNull();
  });

  it("token sesji i sudo nie podszywaja sie pod siebie nawzajem", () => {
    const sesja = signToken(1);
    expect(readScoped("sudo", sesja)).toBeNull();
    expect(readScoped("2fa", sesja)).toBeNull();
    const sudo = signScoped("sudo", 1, 600);
    expect(readToken(sudo)).toBeNull();
    expect(readScoped("2fa", sudo)).toBeNull();
  });

  it("ciasteczko innego przeznaczenia z doklejonym prefiksem nie daje tokenu sesji z wersja NaN", () => {
    // Podpis drugiego kroku liczy sie z "tj-2fa:<wersja>.<termin>". Gdy ktos wyslalby
    // "tj-2fa:<wersja>.<termin>.<podpis>" jako ciasteczko sesji, rozbicie po kropkach dalo
    // wersje "tj-2fa:7" i poprawny podpis. Wersja i termin musza byc liczbami.
    const krok = signScoped("2fa", 7, 300);
    const podrobiony = `tj-2fa:${krok}`;
    expect(readToken(podrobiony)).toBeNull();
    expect(verifyToken(podrobiony, 7)).toBe(false);
    const sudo = signScoped("sudo", 7, 600);
    expect(readToken(`tj-sudo:${sudo}`)).toBeNull();
    expect(readScoped("2fa", `tj-2fa:${krok}`)).toBeNull();
    expect(readScoped("sudo", `x${sudo}`)).toBeNull();
  });

  it("zmieniona wersja, termin albo podpis odrzuca token", () => {
    const [wersja, termin, podpis] = signScoped("sudo", 3, 600, T).split(".");
    expect(readScoped("sudo", `4.${termin}.${podpis}`, T)).toBeNull();
    expect(readScoped("sudo", `${wersja}.${Number(termin) + 600_000}.${podpis}`, T)).toBeNull();
    expect(readScoped("sudo", `${wersja}.${termin}.${podpis.slice(0, -1)}A`, T)).toBeNull();
    expect(readScoped("sudo", undefined, T)).toBeNull();
    expect(readScoped("sudo", "", T)).toBeNull();
    expect(readScoped("sudo", "smieci", T)).toBeNull();
  });
});
