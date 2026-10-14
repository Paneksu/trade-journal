import { and, desc, eq, isNull, lt, max, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  authBackupCodes,
  authEvents,
  settings,
  type AuthEvent,
  type AuthEventKind,
} from "@/lib/db/schema";
import {
  czyKodZapasowy,
  hmacKoduZapasowego,
  noweKodyZapasowe,
  normalizujKod,
  odszyfrujSekret,
  sprawdzKodTotp,
} from "./totp";

/*
 * Warstwa bazy dla 2FA (ADR-031). Bez `next/*`, zeby dalo sie ja testowac na
 * prawdziwej lokalnej bazie. Ciasteczka i naglowki zalatwia `session.ts` i akcje.
 *
 * Wszystkie "zuzycia" (krok TOTP, kod zapasowy) sa jednym warunkowym UPDATE-em:
 * dwa rownolegle zapytania z tym samym kodem nie przejda oba, bo wygrywa baza, a
 * nie odczyt-potem-zapis w aplikacji.
 */

export type WynikDrugiegoSkladnika =
  | { ok: true; rodzaj: "totp" | "backup" }
  | { ok: false; powod: "zly_kod" | "powtorka" | "brak_2fa" };

/**
 * Sprawdza kod wpisany przez uzytkownika: 6 cyfr to TOTP, 10 znakow z alfabetu to
 * kod zapasowy. Poprawny kod zostaje zuzyty. Rzuca, gdy nie da sie odszyfrowac
 * sekretu (zly TOTP_ENC_KEY): to blad konfiguracji, nie "zly kod".
 */
export async function sprawdzDrugiSkladnik(
  wpisane: string,
  teraz = Date.now(),
): Promise<WynikDrugiegoSkladnika> {
  const [s] = await db
    .select({ sekret: settings.totpSecretEnc })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  if (!s?.sekret) return { ok: false, powod: "brak_2fa" };

  const kod = normalizujKod(wpisane);

  // Odszyfrowanie na poczatku, dla KAZDEGO rodzaju kodu: gdy TOTP_ENC_KEY jest inny niz przy
  // wlaczaniu 2FA, wyjatek mowi o konfiguracji. Inaczej kod zapasowy (HMAC liczony tym samym
  // kluczem) po cichu dawalby "zly kod" i wpadal do licznika blokady jak zgadywanie.
  const sekret = odszyfrujSekret(s.sekret);

  if (/^[0-9]{6}$/.test(kod)) {
    const krok = sprawdzKodTotp(sekret, kod, teraz);
    if (krok === null) return { ok: false, powod: "zly_kod" };
    const przyjety = await db
      .update(settings)
      .set({ totpLastStep: krok })
      .where(
        and(
          eq(settings.id, 1),
          or(isNull(settings.totpLastStep), lt(settings.totpLastStep, krok)),
        ),
      )
      .returning({ id: settings.id });
    return przyjety.length > 0 ? { ok: true, rodzaj: "totp" } : { ok: false, powod: "powtorka" };
  }

  if (czyKodZapasowy(kod)) {
    const zuzyty = await db
      .update(authBackupCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(authBackupCodes.codeHmac, hmacKoduZapasowego(kod)), isNull(authBackupCodes.usedAt)))
      .returning({ id: authBackupCodes.id });
    return zuzyty.length > 0 ? { ok: true, rodzaj: "backup" } : { ok: false, powod: "zly_kod" };
  }

  return { ok: false, powod: "zly_kod" };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Nowa paczka kodow zapasowych; stara znika w tej samej transakcji. Zwraca kody jawne (jedyny raz). */
async function podmienKodyZapasowe(tx: Tx): Promise<string[]> {
  const [{ ostatni }] = await tx.select({ ostatni: max(authBackupCodes.batch) }).from(authBackupCodes);
  await tx.delete(authBackupCodes);
  const kody = noweKodyZapasowe();
  await tx.insert(authBackupCodes).values(
    kody.map((k) => ({ codeHmac: hmacKoduZapasowego(k), batch: (ostatni ?? 0) + 1 })),
  );
  return kody;
}

export async function wygenerujKodyZapasowe(): Promise<string[]> {
  return db.transaction(podmienKodyZapasowe);
}

/**
 * Wlacza 2FA: zapisuje zaszyfrowany sekret, krok uzyty do potwierdzenia, nowa paczke
 * kodow i podbija wersje sesji (stare ciasteczka przestaja dzialac). Zwraca nowa wersje.
 * `null` w `wersja`, gdy 2FA bylo juz wlaczone (nie nadpisujemy sekretu po cichu).
 */
export async function wlaczTotp(
  sekretZaszyfrowany: string,
  krok: number,
): Promise<{ wersja: number; kody: string[] } | null> {
  return db.transaction(async (tx) => {
    const zmieniony = await tx
      .update(settings)
      .set({
        totpSecretEnc: sekretZaszyfrowany,
        totpEnabledAt: new Date(),
        totpLastStep: krok,
        sessionVersion: sql`${settings.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(settings.id, 1), isNull(settings.totpSecretEnc)))
      .returning({ wersja: settings.sessionVersion });
    if (zmieniony.length === 0) return null;
    return { wersja: zmieniony[0].wersja, kody: await podmienKodyZapasowe(tx) };
  });
}

/** Wylacza 2FA, kasuje kody zapasowe i podbija wersje sesji. Zwraca nowa wersje (null: 2FA nie bylo). */
export async function wylaczTotp(): Promise<number | null> {
  return db.transaction(async (tx) => {
    const zmieniony = await tx
      .update(settings)
      .set({
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        sessionVersion: sql`${settings.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(settings.id, 1), sql`${settings.totpSecretEnc} is not null`))
      .returning({ wersja: settings.sessionVersion });
    if (zmieniony.length === 0) return null;
    await tx.delete(authBackupCodes);
    return zmieniony[0].wersja;
  });
}

/** Ile kodow zapasowych czeka nieuzytych. */
export async function liczbaWolnychKodow(): Promise<number> {
  const [w] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authBackupCodes)
    .where(isNull(authBackupCodes.usedAt));
  return w?.n ?? 0;
}

/* --- dziennik zdarzen ------------------------------------------------------- */

const MAX_UA = 300;

/**
 * Dopisuje zdarzenie. Blad zapisu nie przerywa logowania (dziennik nie moze
 * zablokowac wlasciciela przed jego danymi), ale idzie do logow serwera.
 * W `detail` NIGDY nie trafia kod, haslo ani sekret.
 */
export async function zapiszZdarzenie(
  rodzaj: AuthEventKind,
  opcje: { ip?: string | null; userAgent?: string | null; tokenId?: number; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(authEvents).values({
      kind: rodzaj,
      ip: opcje.ip ?? null,
      userAgent: opcje.userAgent ? opcje.userAgent.slice(0, MAX_UA) : null,
      tokenId: opcje.tokenId ?? null,
      detail: opcje.detail ?? {},
    });
  } catch (e) {
    console.error(`[auth] nie udało się dopisać zdarzenia "${rodzaj}" do auth_events:`, e);
  }
}

export async function ostatnieZdarzenia(limit = 50): Promise<AuthEvent[]> {
  return db.select().from(authEvents).orderBy(desc(authEvents.at), desc(authEvents.id)).limit(limit);
}
