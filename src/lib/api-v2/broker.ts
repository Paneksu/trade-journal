import "server-only";
import { eq } from "drizzle-orm";

import { apiTokens } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { czytajBajty } from "./body";
import { FORMATY_INBOX, INBOX_MAX_BAJTOW } from "./contract/broker";
import { blad, odpowiedz } from "./http";
import { przepusc } from "./limiter";
import { BladImportu, zastosujPlikBrokera, type WynikImportu } from "@/lib/brokerzy/import";
import type { KontekstApi } from "./with-api";

/**
 * Przyjecie pliku z automatu `tj watch-exports` (ADR-034 pkt 3). JEDYNA trasa, ktora otwiera zakres `import_broker`, i
 * jedyny zakres tej trasy. Robi to samo co »Zapisz import« w UI (parser, grupowanie, dopasowanie), z roznicami:
 *  - dopasowania 1:1 stosuje od razu (rodzaj `auto`, z »Cofnij« w UI), reszta czeka w »Do decyzji«;
 *  - nigdy nie tworzy trade'a w dzienniku, nie przypisuje konta, nie laczy z OAuth;
 *  - plik z blednymi wierszami nie jest stosowany (zostaje u klienta; powod trafia do »Do decyzji«).
 * Odpowiedz niesie SHA-256 przyjetych bajtow: automat kasuje plik dopiero, gdy jest rowny jego wlasnemu.
 */

/** Najwyzej 30 plikow na 10 minut na token (eksport to kilka plikow dziennie; reszta to petla albo atak). */
const LIMIT_PLIKOW = 30;
const OKNO_PLIKOW_MS = 10 * 60_000;

const DOZWOLONE_TYPY = /^(text\/csv|application\/octet-stream|application\/csv|text\/plain)\b/i;

function odpowiedzZWyniku(w: WynikImportu, requestId: string): Response {
  const naglowki = { "x-request-id": requestId };
  if (!w.ok) {
    return blad(
      w.status,
      w.kod,
      w.komunikat,
      {
        ...(w.sha256 ? { sha256: w.sha256 } : {}),
        ...(w.importId !== undefined && w.importId !== null ? { importId: w.importId } : {}),
        ...(w.bledy ? { rowErrors: w.bledy.slice(0, 20) } : {}),
      },
      naglowki,
    );
  }
  return odpowiedz(
    {
      sha256: w.sha256,
      status: w.status,
      format: w.format,
      platform: w.platforma,
      importId: w.importId,
      timezone: w.strefa,
      fills: { new: w.wypelnienia.nowe, duplicate: w.wypelnienia.duplikaty },
      cashEvents: { new: w.zdarzenia.nowe, duplicate: w.zdarzenia.duplikaty },
      trades: { matched: w.trade.dopasowane, needsDecision: w.trade.doDecyzji, open: w.trade.otwarte },
      notes: w.ostrzezenia.map((o) => o.message),
    },
    w.status === "applied" ? 201 : 200,
    naglowki,
  );
}

/** Zakres `import_broker` ma byc JEDYNYM zakresem tokenu (baza tez to pilnuje, CHECK + trigger); tu druga warstwa. */
function tokenImportuBrokera(api: KontekstApi): Response | null {
  if (api.token.scopes.length === 1 && api.token.scopes[0] === "import_broker") return null;
  return blad(
    403,
    "insufficient_scope",
    `Token „${api.token.name}” ma zakresy: ${api.token.scopes.join(", ")}. Ta trasa przyjmuje wyłącznie token, którego jedynym zakresem jest import_broker (wydaje go użytkownik w aplikacji: Ustawienia → Urządzenia).`,
    { requiredScopes: ["import_broker"] },
    { "x-request-id": api.requestId },
  );
}

export async function obsluzInboxPing(api: KontekstApi): Promise<Response> {
  const zly = tokenImportuBrokera(api);
  if (zly) return zly;
  const [t] = await db.select({ expiresAt: apiTokens.expiresAt }).from(apiTokens).where(eq(apiTokens.id, api.token.id)).limit(1);
  return odpowiedz({ accepts: [...FORMATY_INBOX], maxBytes: INBOX_MAX_BAJTOW, tokenName: api.token.name, expiresAt: t?.expiresAt?.toISOString() ?? null });
}

export async function obsluzInbox(request: Request, api: KontekstApi): Promise<Response> {
  const zly = tokenImportuBrokera(api);
  if (zly) return zly;
  const naglowki = { "x-request-id": api.requestId };

  const limit = przepusc(`api2-inbox:${api.token.id}`, LIMIT_PLIKOW, OKNO_PLIKOW_MS);
  if (!limit.allowed) {
    return blad(429, "rate_limited", `Przekroczony limit ${LIMIT_PLIKOW} plików na 10 minut dla tokenu „${api.token.name}”. Spróbuj ponownie za ${limit.retryInS} s.`, { retryInS: limit.retryInS }, { ...naglowki, "Retry-After": String(limit.retryInS) });
  }

  const typ = request.headers.get("content-type") ?? "";
  if (!DOZWOLONE_TYPY.test(typ)) {
    return blad(415, "unsupported_media_type", `Content-Type »${typ || "brak"}« nie jest obsługiwany. Wyślij surowe bajty pliku jako text/csv.`, {}, naglowki);
  }
  const oczekiwany = request.headers.get("x-tj-sha256")?.trim().toLowerCase() || null;
  if (oczekiwany !== null && !/^[0-9a-f]{64}$/.test(oczekiwany)) {
    return blad(400, "bad_request", `Nagłówek X-Tj-Sha256 »${oczekiwany.slice(0, 80)}« nie jest skrótem SHA-256 (64 znaki hex).`, {}, naglowki);
  }
  const cialo = await czytajBajty(request, INBOX_MAX_BAJTOW);
  if (!cialo.ok) {
    return blad(413, "payload_too_large", `Plik ma co najmniej ${cialo.odczytano} B, a limit to ${cialo.limit} B (5 MB). Wyeksportuj krótszy zakres dat; plik nie został zapisany ani przycięty.`, {}, naglowki);
  }

  const wykonaj = () =>
    api.zapis((tx) =>
      zastosujPlikBrokera(tx, {
        bajty: cialo.bytes,
        pochodzenie: "tj_watch",
        tokenId: api.token.id,
        strefa: null,
        oczekiwanySha: oczekiwany,
      }),
    );

  let wynik: WynikImportu;
  try {
    wynik = await wykonaj();
  } catch (e) {
    if (e instanceof BladImportu) return blad(e.status, e.kod, e.message, {}, naglowki);
    // Dwa rownolegle wyslania tego samego pliku: drugi trafia na unikalny SHA zatwierdzonego importu i dostaje wynik »duplicate«.
    const kod = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (kod === "23505") {
      wynik = await wykonaj();
    } else {
      throw e;
    }
  }
  console.info(`[api-v2 ${api.requestId}] inbox: token #${api.token.id}, ${wynik.ok ? `${wynik.status} import #${wynik.importId} (${wynik.format}, ${wynik.wypelnienia.nowe} nowych wypełnień)` : `odrzucono ${wynik.kod}`}`);
  return odpowiedzZWyniku(wynik, api.requestId);
}
