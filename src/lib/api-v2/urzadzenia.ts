import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { apiTokens, deviceCodes } from "@/lib/db/schema";

import { czyScope, type Scope } from "./scopes";
import { normalizujKodUzytkownika } from "./token";

/**
 * Strona aplikacji dla urzadzen (Ustawienia -> Urzadzenia, /urzadzenia/polacz).
 * Czysta logika bazy bez Next (akcje serwera w `lib/actions/devices.ts` tylko
 * sprawdzaja sesje i wolaja te funkcje), dzieki czemu da sie ja testowac na bazie.
 */

/** Token nieuzywany od tylu dni jest oznaczany w UI jako kandydat do uniewaznienia (ADR-030). */
export const DNI_NIEAKTYWNOSCI = 90;

export type StatusTokenu = "aktywny" | "uniewazniony" | "wygasly";

export type WierszTokenu = {
  id: number;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdVia: "device_code" | "ui";
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  status: StatusTokenu;
  /** Aktywny, ale nieuzywany od 90 dni (albo nigdy, a starszy niz 90 dni). */
  nieuzywany: boolean;
};

export function statusTokenu(t: { revokedAt: Date | null; expiresAt: Date | null }, teraz: Date = new Date()): StatusTokenu {
  if (t.revokedAt) return "uniewazniony";
  if (t.expiresAt && t.expiresAt.getTime() <= teraz.getTime()) return "wygasly";
  return "aktywny";
}

export async function listaTokenow(teraz: Date = new Date()): Promise<WierszTokenu[]> {
  const wiersze = await db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  const granica = teraz.getTime() - DNI_NIEAKTYWNOSCI * 24 * 3600 * 1000;
  return wiersze.map((t) => {
    const status = statusTokenu(t, teraz);
    const ostatnia = (t.lastUsedAt ?? t.createdAt).getTime();
    return {
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      scopes: t.scopes.filter(czyScope),
      createdVia: t.createdVia,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      lastUsedIp: t.lastUsedIp,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
      revokedReason: t.revokedReason,
      status,
      nieuzywany: status === "aktywny" && ostatnia < granica,
    };
  });
}

export async function uniewaznToken(id: number, powod = "ui"): Promise<{ ok: true } | { ok: false; komunikat: string }> {
  const zmienione = await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()`, revokedReason: powod })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (zmienione.length === 0) {
    const [t] = await db.select({ revokedAt: apiTokens.revokedAt }).from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
    return {
      ok: false,
      komunikat: t ? `Token #${id} jest już unieważniony.` : `Token #${id} nie istnieje.`,
    };
  }
  return { ok: true };
}

export type KodDoZatwierdzenia = {
  id: number;
  userCode: string;
  clientName: string;
  clientIp: string | null;
  requestedScopes: Scope[];
  createdAt: Date;
  expiresAt: Date;
};

/** Kod przepisany przez uzytkownika -> zadanie czekajace na decyzje (niewygasle, bez decyzji). */
export async function znajdzKodDoZatwierdzenia(wpisany: string): Promise<{ ok: true; kod: KodDoZatwierdzenia } | { ok: false; komunikat: string }> {
  const kod = normalizujKodUzytkownika(wpisany);
  if (!kod) {
    return {
      ok: false,
      komunikat: `Kod »${wpisany.slice(0, 20)}« ma zły format. Powinien mieć 8 liter, np. BCDF-GHJK (bez samogłosek i bez Y), tak jak pokazuje terminal.`,
    };
  }
  const [w] = await db.select().from(deviceCodes).where(eq(deviceCodes.userCode, kod)).limit(1);
  if (!w) return { ok: false, komunikat: `Nie ma żądania z kodem ${kod}. Sprawdź kod w terminalu albo uruchom \`tj login\` ponownie.` };
  if (w.consumedAt || w.approvedAt || w.deniedAt) {
    return { ok: false, komunikat: `Żądanie ${kod} ma już decyzję. Uruchom \`tj login\` ponownie, jeśli urządzenie nadal czeka.` };
  }
  if (w.expiresAt.getTime() <= Date.now()) {
    return { ok: false, komunikat: `Kod ${kod} wygasł (ważny 10 minut). Uruchom \`tj login\` ponownie.` };
  }
  return {
    ok: true,
    kod: {
      id: w.id,
      userCode: w.userCode,
      clientName: w.clientName,
      clientIp: w.clientIp,
      requestedScopes: w.requestedScopes.filter(czyScope),
      createdAt: w.createdAt,
      expiresAt: w.expiresAt,
    },
  };
}

/** Zatwierdzenie z zawezeniem zakresow: nadane musza byc podzbiorem zadanych i niepuste. */
export async function zatwierdzKod(
  id: number,
  nadane: string[],
): Promise<{ ok: true; scopes: Scope[] } | { ok: false; komunikat: string }> {
  const [w] = await db.select().from(deviceCodes).where(eq(deviceCodes.id, id)).limit(1);
  if (!w) return { ok: false, komunikat: "Nie ma takiego żądania." };
  const zadane = new Set<string>(w.requestedScopes);
  const unikalne = [...new Set(nadane)];
  const zly = unikalne.find((s) => !czyScope(s) || !zadane.has(s));
  if (zly !== undefined) {
    return {
      ok: false,
      komunikat: `Zakres »${zly}« nie był żądany przez urządzenie (żądane: ${w.requestedScopes.join(", ")}). Nie da się nadać więcej, niż urządzenie poprosiło, a zakresu zatwierdzania nie ma.`,
    };
  }
  if (unikalne.length === 0) {
    return { ok: false, komunikat: "Zaznacz co najmniej jeden zakres albo odrzuć urządzenie." };
  }
  const zakresy = unikalne.filter(czyScope);
  const zmienione = await db
    .update(deviceCodes)
    .set({ approvedAt: sql`now()`, grantedScopes: zakresy })
    .where(
      and(
        eq(deviceCodes.id, id),
        isNull(deviceCodes.approvedAt),
        isNull(deviceCodes.deniedAt),
        gt(deviceCodes.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: deviceCodes.id });
  if (zmienione.length === 0) {
    return { ok: false, komunikat: "Żądanie wygasło albo ma już decyzję. Uruchom `tj login` ponownie." };
  }
  return { ok: true, scopes: zakresy };
}

export async function odrzucKod(id: number): Promise<{ ok: true } | { ok: false; komunikat: string }> {
  const zmienione = await db
    .update(deviceCodes)
    .set({ deniedAt: sql`now()` })
    .where(and(eq(deviceCodes.id, id), isNull(deviceCodes.approvedAt), isNull(deviceCodes.deniedAt)))
    .returning({ id: deviceCodes.id });
  if (zmienione.length === 0) return { ok: false, komunikat: "Żądanie ma już decyzję albo nie istnieje." };
  return { ok: true };
}

/** Zadania czekajace na decyzje (do podgladu na stronie Urzadzenia). */
export async function oczekujaceKody(): Promise<KodDoZatwierdzenia[]> {
  const wiersze = await db
    .select()
    .from(deviceCodes)
    .where(and(isNull(deviceCodes.approvedAt), isNull(deviceCodes.deniedAt), isNull(deviceCodes.consumedAt), gt(deviceCodes.expiresAt, sql`now()`)))
    .orderBy(desc(deviceCodes.createdAt));
  return wiersze.map((w) => ({
    id: w.id,
    userCode: w.userCode,
    clientName: w.clientName,
    clientIp: w.clientIp,
    requestedScopes: w.requestedScopes.filter(czyScope),
    createdAt: w.createdAt,
    expiresAt: w.expiresAt,
  }));
}
