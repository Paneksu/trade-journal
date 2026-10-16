import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import type { Transakcja } from "@/lib/api-v2/zapis";
import {
  authEvents,
  brokerAccounts,
  brokerCashEvents,
  brokerFills,
  brokerImports,
  brokerTrades,
  ingestSkips,
  settings,
  trades,
  type OstrzezenieImportu,
} from "@/lib/db/schema";
import { wykryjPrzesunieciaStrefy, type Dopasowanie } from "@/lib/domain/brokerzy/dopasowanie";
import { FORMATY } from "@/lib/domain/brokerzy/formaty";
import { parsujPlikBrokera } from "@/lib/domain/brokerzy/tradovate";
import type { Wypelnienie, ZdarzenieCash } from "@/lib/domain/brokerzy/typy";
import type { PlatformaBrokera } from "@/lib/db/schema";
import { persistTrade } from "@/lib/trades/persist";
import type { TradeDraft } from "@/lib/domain/trade-draft";

import { przebiegDopasowania, type ZastosowaneDopasowanie } from "./dopasowania";
import { skrotKonta, sha256Hex } from "./klucz";
import {
  poczatekOkna,
  prefiksWypelnien,
  przeliczOkno,
  refWypelnienia,
  refZdarzenia,
  wczytajDomene,
  type KontoBrokeraKontekst,
  type WierszTraduBrokera,
} from "./przeliczanie";

/**
 * Import pliku z brokera: jedna implementacja dla podgladu w UI (suchy bieg w transakcji, ktora sie wycofuje), zapisu z UI
 * i automatu `POST /api/v2/broker/inbox` (ADR-034 pkt 2 i 3). Wszystko w transakcji wolajacego, z aktorem `ui` albo tokenem
 * importu. Plik nie jest nigdzie zapisywany: parsujemy go w pamieci; zostaje SHA-256, liczniki i wiersze wypelnien.
 */

export type OpcjeImportu = {
  bajty: Uint8Array;
  pochodzenie: "ui" | "tj_watch";
  tokenId: number | null;
  /** Strefa dla czasow bez przesuniecia: wybrana w UI albo ustawienie uzytkownika (automat bierze `broker_accounts.tz`, potem ustawienie). */
  strefa: string | null;
  /** UI: przypisania kont u brokera do kont dziennika (klucz: pelny HMAC konta). `null` = zostaw nieprzypisane. */
  przypisania?: Record<string, number | null>;
  /** UI: trade'y brokera (external_ref), dla ktorych NIE stosowac dopasowania 1:1. */
  odznaczone?: string[];
  /** UI: trade'y brokera (external_ref), z ktorych utworzyc trade dziennika (tylko zaznaczone na podgladzie). */
  utworz?: string[];
  /** UI: swiadome pominiecie blednych wierszy. Automat nigdy ich nie pomija. */
  pominBledneWiersze?: boolean;
  /** SHA-256 oczekiwany przez wolajacego (z podgladu albo naglowka automatu); niezgodnosc = odrzucenie. */
  oczekiwanySha?: string | null;
  teraz?: Date;
};

export type PozycjaImportu = {
  id: number;
  externalRef: string;
  kontrakt: string;
  kierunek: "long" | "short";
  ilosc: number;
  wejscie: string;
  wyjscie: string | null;
  cenaWejscia: number;
  cenaWyjscia: number | null;
  status: "open" | "closed";
  bruttoCenty: number | null;
  oplatyCenty: number | null;
  zrodloOplat: "broker" | "rate" | null;
  nettoCenty: number | null;
  zrodloBrutto: "broker" | "computed" | null;
  kontoOstatnie4: string | null;
  kontoDziennikaId: number | null;
  stanDopasowania: "unmatched" | "ambiguous" | "matched" | "skipped";
  rodzajDopasowania: string | null;
  tradeId: number | null;
  kandydaci: number[];
  powod: string | null;
  pnlPrzed: number | null;
  pnlPo: number | null;
  nowy: boolean;
  /** Czy trade dziennika zostal utworzony z danych brokera w tym imporcie. */
  utworzony: boolean;
};

export type KontoWPliku = {
  hmac: string;
  ostatnie4: string;
  brokerAccountId: number | null;
  kontoDziennikaId: number | null;
  nowe: boolean;
};

export type SukcesImportu = {
  ok: true;
  status: "applied" | "duplicate";
  importId: number;
  sha256: string;
  format: string;
  platforma: string;
  strefa: string;
  wypelnienia: { nowe: number; duplikaty: number };
  zdarzenia: { nowe: number; duplikaty: number };
  wiersze: { razem: number; pominiete: number; bledne: number };
  trade: { dopasowane: number; doDecyzji: number; otwarte: number; utworzone: number };
  konta: KontoWPliku[];
  pozycje: PozycjaImportu[];
  zastosowane: ZastosowaneDopasowanie[];
  ostrzezenia: OstrzezenieImportu[];
  bledy: { numerWiersza: number; powod: string }[];
  /** Data poprzedniego importu tego samego pliku (status duplicate). */
  zaimportowanoWczesniej: string | null;
};

export type PorazkaImportu = {
  ok: false;
  status: 400 | 409 | 413 | 415 | 422 | 503;
  kod: string;
  komunikat: string;
  /** Id wiersza `broker_imports` ze statusem rejected, jesli odrzucenie zapisano. */
  importId?: number | null;
  bledy?: { numerWiersza: number; powod: string }[];
  sha256?: string;
};

export type WynikImportu = SukcesImportu | PorazkaImportu;

const KODY_KOMPRESJI: Record<string, 400 | 413> = { too_large: 413, too_many_rows: 413, too_many_columns: 413, cell_too_long: 413 };

async function strefaUzytkownika(tx: Transakcja): Promise<string> {
  const [s] = await tx.select({ tz: settings.timezone }).from(settings).limit(1);
  return s?.tz ?? "Europe/Warsaw";
}

type PlikSparsowany = Extract<ReturnType<typeof parsujPlikBrokera>, { ok: true }>;

function wiersze(p: PlikSparsowany): { razem: number; pominiete: number; bledne: number } {
  return { razem: p.wierszy, pominiete: p.pominiete, bledne: p.bledy.length };
}

/** Zapis odrzuconego pliku (rozpoznany format, ale wiersze bledne): widoczny w »Do decyzji«, bez danych z pliku. */
async function zapiszOdrzucenie(
  tx: Transakcja,
  o: OpcjeImportu,
  sha: string,
  p: PlikSparsowany,
  strefa: string,
  powod: string,
): Promise<number | null> {
  const [istniejacy] = await tx
    .select({ id: brokerImports.id })
    .from(brokerImports)
    .where(and(eq(brokerImports.fileSha256, sha), eq(brokerImports.status, "rejected")))
    .limit(1);
  if (istniejacy) return istniejacy.id;
  const [w] = await tx
    .insert(brokerImports)
    .values({
      origin: o.pochodzenie,
      format: p.format,
      fileSha256: sha,
      fileBytes: o.bajty.length,
      tz: strefa,
      rowsTotal: p.wierszy,
      rowsSkipped: p.pominiete + p.bledy.length,
      fillsNew: 0,
      fillsDuplicate: 0,
      tradesMatched: 0,
      tradesCreated: 0,
      pendingDecisions: 0,
      status: "rejected",
      warnings: p.ostrzezenia as OstrzezenieImportu[],
      note: powod.slice(0, 1000),
      createdByTokenId: o.tokenId,
    })
    .returning({ id: brokerImports.id });
  await tx.insert(authEvents).values({
    kind: "broker_import_rejected",
    tokenId: o.tokenId,
    detail: { importId: w.id, origin: o.pochodzenie, format: p.format, bledy: p.bledy.length, powod: powod.slice(0, 200) },
  });
  return w.id;
}

export async function zastosujPlikBrokera(tx: Transakcja, o: OpcjeImportu): Promise<WynikImportu> {
  const teraz = o.teraz ?? new Date();
  const sha = sha256Hex(o.bajty);
  if (o.oczekiwanySha && o.oczekiwanySha.toLowerCase() !== sha) {
    return {
      ok: false,
      status: 409,
      kod: "sha_mismatch",
      komunikat: `Skrót SHA-256 pliku (${sha}) nie zgadza się z oczekiwanym (${o.oczekiwanySha}). Plik zmienił się między podglądem a zapisem albo został uszkodzony w drodze. Wgraj go ponownie.`,
      sha256: sha,
    };
  }

  // Ten sam plik (ten sam SHA-256) drugi raz: nic sie nie dubluje.
  const [duplikat] = await tx
    .select()
    .from(brokerImports)
    .where(and(eq(brokerImports.fileSha256, sha), eq(brokerImports.status, "committed")))
    .limit(1);
  if (duplikat) {
    return {
      ok: true,
      status: "duplicate",
      importId: duplikat.id,
      sha256: sha,
      format: duplikat.format,
      platforma: FORMATY.find((f) => f.nazwa === duplikat.format)?.platforma ?? "generic",
      strefa: duplikat.tz,
      wypelnienia: { nowe: 0, duplikaty: duplikat.fillsNew + duplikat.fillsDuplicate },
      zdarzenia: { nowe: 0, duplikaty: 0 },
      wiersze: { razem: duplikat.rowsTotal, pominiete: duplikat.rowsSkipped, bledne: 0 },
      trade: { dopasowane: duplikat.tradesMatched, doDecyzji: duplikat.pendingDecisions, otwarte: 0, utworzone: duplikat.tradesCreated },
      konta: [],
      pozycje: [],
      zastosowane: [],
      ostrzezenia: (duplikat.warnings as OstrzezenieImportu[]) ?? [],
      bledy: [],
      zaimportowanoWczesniej: duplikat.createdAt.toISOString(),
    };
  }

  // --- parsowanie (strefa: wybrana, potem ustawienie uzytkownika; konto z zapisana strefa moze ja zmienic) ---
  let strefa = o.strefa ?? (await strefaUzytkownika(tx));
  let parsed = parsujPlikBrokera(o.bajty, { strefa, teraz });
  if (!parsed.ok) {
    return { ok: false, status: KODY_KOMPRESJI[parsed.kod] ?? (parsed.kod === "bad_encoding" ? 415 : 422), kod: parsed.kod, komunikat: parsed.komunikat, sha256: sha };
  }
  const p0: PlikSparsowany = parsed;
  const platforma = FORMATY.find((f) => f.nazwa === p0.format)!.platforma as PlatformaBrokera;

  const rawKonta = [...new Set([...parsed.wypelnienia.map((w) => w.konto), ...parsed.zdarzenia.map((z) => z.konto)])];
  let skroty;
  try {
    skroty = new Map(rawKonta.map((k) => [k, skrotKonta(platforma, k)]));
  } catch (e) {
    return { ok: false, status: 503, kod: "broker_not_configured", komunikat: e instanceof Error ? e.message : "Import z brokera nie jest skonfigurowany.", sha256: sha };
  }

  // Strefa zapisana przy koncie (automat) ma pierwszenstwo, gdy UI jej nie wybralo.
  if (o.strefa === null && skroty.size > 0) {
    const zapisane = await tx
      .select({ tz: brokerAccounts.tz })
      .from(brokerAccounts)
      .where(and(eq(brokerAccounts.platform, platforma), inArray(brokerAccounts.externalAccountHmac, [...skroty.values()].map((s) => s.hmac))));
    const strefyKont = [...new Set(zapisane.map((z) => z.tz).filter((t): t is string => t !== null))];
    if (strefyKont.length === 1 && strefyKont[0] !== strefa) {
      strefa = strefyKont[0];
      const ponownie = parsujPlikBrokera(o.bajty, { strefa, teraz });
      if (ponownie.ok) parsed = ponownie;
    }
  }
  const p: PlikSparsowany = parsed;
  const ostrzezenia: OstrzezenieImportu[] = [...p.ostrzezenia];
  if (p.czasBezStrefy) {
    ostrzezenia.push({
      code: "strefa_zalozona",
      message: `Plik nie podaje strefy czasowej. Czasy odczytano jako czas w strefie ${strefa} (${o.strefa ? "wybranej przy wgrywaniu" : "z ustawień konta lub użytkownika"}). Jeśli godziny wejść się nie zgadzają z dziennikiem, zmień strefę i wgraj plik ponownie.`,
    });
  }

  if (p.bledy.length > 0 && !(o.pochodzenie === "ui" && o.pominBledneWiersze)) {
    const lista = p.bledy.slice(0, 5).map((b) => `wiersz ${b.numerWiersza}: ${b.powod}`).join("; ");
    const komunikat =
      o.pochodzenie === "ui"
        ? `Plik ma ${p.bledy.length} błędnych wierszy (${lista}). Zapis wymaga świadomego pominięcia tych wierszy albo poprawienia pliku.`
        : `Plik ma ${p.bledy.length} błędnych wierszy (${lista}). Automat nie stosuje plików z błędami: plik zostaje w folderze, a powód jest w „Do decyzji” w aplikacji. Wgraj go ręcznie i pomiń błędne wiersze albo wyeksportuj ponownie.`;
    const importId = o.pochodzenie === "tj_watch" ? await zapiszOdrzucenie(tx, o, sha, p, strefa, komunikat) : null;
    return { ok: false, status: 422, kod: "rows_invalid", komunikat, bledy: p.bledy, sha256: sha, importId };
  }

  // --- wiersz importu (liczniki uzupelniamy na koncu) ---
  const [imp] = await tx
    .insert(brokerImports)
    .values({
      origin: o.pochodzenie,
      format: p.format,
      fileSha256: sha,
      fileBytes: o.bajty.length,
      tz: strefa,
      rowsTotal: p.wierszy,
      rowsSkipped: p.pominiete + p.bledy.length,
      fillsNew: 0,
      fillsDuplicate: 0,
      tradesMatched: 0,
      tradesCreated: 0,
      pendingDecisions: 0,
      status: "committed",
      warnings: [],
      createdByTokenId: o.tokenId,
    })
    .returning({ id: brokerImports.id });

  // --- konta u brokera ---
  const kontaWPliku: KontoWPliku[] = [];
  const konteksty = new Map<string, KontoBrokeraKontekst>();
  for (const [raw, skrot] of skroty) {
    let [ba] = await tx
      .select()
      .from(brokerAccounts)
      .where(and(eq(brokerAccounts.platform, platforma), eq(brokerAccounts.externalAccountHmac, skrot.hmac)))
      .limit(1);
    let nowe = false;
    const zadane = o.pochodzenie === "ui" ? (o.przypisania?.[skrot.hmac] ?? null) : null;
    if (!ba) {
      if (zadane !== null) {
        const [zajete] = await tx.select({ id: brokerAccounts.id }).from(brokerAccounts).where(eq(brokerAccounts.accountId, zadane)).limit(1);
        if (zajete) {
          throw new BladImportu(409, "account_taken", `Konto dziennika #${zadane} jest już przypisane do innego konta u brokera (#${zajete.id}). Jedno konto dziennika ma co najwyżej jedno konto u brokera. Wybierz inne konto albo najpierw odepnij to.`);
        }
      }
      [ba] = await tx
        .insert(brokerAccounts)
        .values({ accountId: zadane, platform: platforma, method: "export_file", externalAccountHmac: skrot.hmac, labelLast4: skrot.ostatnie4 })
        .returning();
      nowe = true;
      if (zadane !== null) await tx.insert(authEvents).values({ kind: "broker_account_mapped", detail: { brokerAccountId: ba.id, accountId: zadane, via: "import" } });
    } else if (zadane !== null && ba.accountId !== zadane) {
      if (ba.accountId !== null) {
        ostrzezenia.push({ code: "konto_juz_przypisane", message: `Konto u brokera …${skrot.ostatnie4} jest już przypisane do konta dziennika #${ba.accountId}; zmiana przypisania nie jest częścią importu (odepnij konto w Połączeniach).` });
      } else {
        const [zajete] = await tx.select({ id: brokerAccounts.id }).from(brokerAccounts).where(eq(brokerAccounts.accountId, zadane)).limit(1);
        if (zajete) {
          throw new BladImportu(409, "account_taken", `Konto dziennika #${zadane} jest już przypisane do innego konta u brokera (#${zajete.id}). Wybierz inne konto.`);
        }
        [ba] = await tx.update(brokerAccounts).set({ accountId: zadane }).where(eq(brokerAccounts.id, ba.id)).returning();
        await tx.insert(authEvents).values({ kind: "broker_account_mapped", detail: { brokerAccountId: ba.id, accountId: zadane, via: "import" } });
      }
    }
    konteksty.set(raw, { id: ba.id, platforma, krotki: skrot.krotki, kontoDziennikaId: ba.accountId });
    kontaWPliku.push({ hmac: skrot.hmac, ostatnie4: skrot.ostatnie4, brokerAccountId: ba.id, kontoDziennikaId: ba.accountId, nowe });
  }

  // --- wypelnienia i zdarzenia ---
  const nowe = { wyp: 0, zd: 0, dupWyp: 0, dupZd: 0 };
  const najwczesniej = new Map<string, { konto: KontoBrokeraKontekst; kontrakt: string; czas: Date }>();
  const dotknij = (k: KontoBrokeraKontekst, kontrakt: string, czas: Date): void => {
    const klucz = `${k.id}|${kontrakt}`;
    const jest = najwczesniej.get(klucz);
    if (!jest || czas.getTime() < jest.czas.getTime()) najwczesniej.set(klucz, { konto: k, kontrakt, czas });
  };

  const ROZMIAR_PACZKI = 500;
  for (let i = 0; i < p.wypelnienia.length; i += ROZMIAR_PACZKI) {
    const paczka = p.wypelnienia.slice(i, i + ROZMIAR_PACZKI);
    const wiersze = paczka.map((w: Wypelnienie) => {
      const k = konteksty.get(w.konto)!;
      return {
        brokerAccountId: k.id,
        importId: imp.id,
        externalRef: refWypelnienia(k, w.idZrodla),
        contract: w.kontrakt,
        side: w.strona,
        qty: String(w.ilosc),
        price: String(w.cena),
        filledAt: w.czas,
        orderRef: w.zlecenie,
        raw: w.raw,
      };
    });
    const wstawione = await tx.insert(brokerFills).values(wiersze).onConflictDoNothing({ target: brokerFills.externalRef }).returning({ ref: brokerFills.externalRef });
    const nowych = new Set(wstawione.map((x) => x.ref));
    nowe.wyp += nowych.size;
    nowe.dupWyp += paczka.length - nowych.size;
    for (const w of paczka) {
      const k = konteksty.get(w.konto)!;
      if (nowych.has(refWypelnienia(k, w.idZrodla))) dotknij(k, w.kontrakt, w.czas);
    }
  }
  for (let i = 0; i < p.zdarzenia.length; i += ROZMIAR_PACZKI) {
    const paczka = p.zdarzenia.slice(i, i + ROZMIAR_PACZKI);
    const wiersze = paczka.map((z: ZdarzenieCash) => {
      const k = konteksty.get(z.konto)!;
      return {
        brokerAccountId: k.id,
        importId: imp.id,
        externalRef: refZdarzenia(k, z.idZrodla),
        kind: z.rodzaj,
        deltaCents: z.deltaCenty,
        contract: z.kontrakt,
        occurredAt: z.czas,
        raw: z.raw,
      };
    });
    const wstawione = await tx.insert(brokerCashEvents).values(wiersze).onConflictDoNothing({ target: brokerCashEvents.externalRef }).returning({ ref: brokerCashEvents.externalRef });
    const nowych = new Set(wstawione.map((x) => x.ref));
    nowe.zd += nowych.size;
    nowe.dupZd += paczka.length - nowych.size;
    for (const z of paczka) {
      const k = konteksty.get(z.konto)!;
      if (z.kontrakt !== null && nowych.has(refZdarzenia(k, z.idZrodla))) dotknij(k, z.kontrakt, z.czas);
    }
  }

  // --- przeliczenie trade'ow brokera ---
  const skutki: Awaited<ReturnType<typeof przeliczOkno>>[] = [];
  for (const { konto, kontrakt, czas } of najwczesniej.values()) {
    skutki.push(await przeliczOkno(tx, konto, kontrakt, czas, imp.id));
  }
  const dotkniete = skutki.flatMap((s) => s.trade);
  const idyTrade = new Set(dotkniete.map((t) => t.wiersz.id));

  // --- dopasowanie 1:1 (UI: zaznaczone na podgladzie, automat: od razu z "Cofnij") ---
  const kontaDoDopasowania = [...new Set([...konteksty.values()].filter((k) => k.kontoDziennikaId !== null).map((k) => k.id))];
  const przebieg = await przebiegDopasowania(tx, {
    kontaBrokera: kontaDoDopasowania,
    rodzaj: o.pochodzenie === "ui" ? "user" : "auto",
    odznaczone: new Set(o.odznaczone ?? []),
  });
  for (const z of przebieg.zastosowane) idyTrade.add(z.brokerTradeId);
  for (const b of przebieg.bledy) {
    ostrzezenia.push({ code: "dopasowanie_nieudane", message: `Dopasowanie trade'a brokera #${b.brokerTradeId} nie przeszło: ${b.komunikat}.` });
  }

  // --- tworzenie trade'ow dziennika z danych brokera (tylko UI, tylko zaznaczone) ---
  const utworzone: { brokerTradeId: number; tradeId: number }[] = [];
  if (o.pochodzenie === "ui" && (o.utworz?.length ?? 0) > 0) {
    const zadane = new Set(o.utworz);
    for (const { wiersz, domena } of dotkniete) {
      if (!zadane.has(wiersz.externalRef)) continue;
      const [swiezy] = await tx.select().from(brokerTrades).where(eq(brokerTrades.id, wiersz.id)).limit(1);
      if (!swiezy || swiezy.tradeId !== null || swiezy.status !== "closed") continue;
      const ctx = [...konteksty.values()].find((k) => k.id === swiezy.brokerAccountId);
      if (!ctx || ctx.kontoDziennikaId === null) {
        ostrzezenia.push({ code: "utworzenie_pominiete", message: `Nie utworzono trade'a z ${wiersz.externalRef}: konto u brokera nie jest przypisane do konta dziennika.` });
        continue;
      }
      if (swiezy.instrumentId === null) {
        ostrzezenia.push({ code: "utworzenie_pominiete", message: `Nie utworzono trade'a z ${wiersz.externalRef}: kontrakt ${swiezy.contract} nie ma instrumentu w dzienniku (dodaj go w Ustawieniach).` });
        continue;
      }
      const [nagrobek] = await tx.select({ id: ingestSkips.id }).from(ingestSkips).where(eq(ingestSkips.externalRef, swiezy.externalRef)).limit(1);
      if (nagrobek) {
        ostrzezenia.push({ code: "utworzenie_pominiete", message: `Nie utworzono trade'a z ${wiersz.externalRef}: został wcześniej skasowany w aplikacji (nagrobek).` });
        continue;
      }
      const w = await utworzTradeZDanychBrokera(tx, swiezy, ctx.kontoDziennikaId, domena);
      if (w.ok) {
        utworzone.push({ brokerTradeId: swiezy.id, tradeId: w.tradeId });
        idyTrade.add(swiezy.id);
      } else {
        ostrzezenia.push({ code: "utworzenie_nieudane", message: `Trade z ${wiersz.externalRef} nie powstał: ${w.komunikat}.` });
      }
    }
  }

  // --- ostrzezenie o mozliwym przesunieciu strefy (nie przesuwamy sami) ---
  const przesuniecie = await podejrzeniePrzesuniecia(tx, kontaDoDopasowania);
  if (przesuniecie) {
    ostrzezenia.push({
      code: "strefa_podejrzana",
      message: `Po przesunięciu czasów w pliku o ${przesuniecie.godziny > 0 ? "+" : ""}${przesuniecie.godziny} h dopasowałoby się ${przesuniecie.dopasowan} trade'ów dziennika 1:1 (bez przesunięcia: ${przesuniecie.bazowo}). Plik nie podaje strefy, więc to możliwa pomyłka: wgraj plik ponownie z inną strefą. Niczego nie przesunięto.`,
    });
  }

  // --- pozycje do raportu ---
  const finalne = idyTrade.size === 0 ? [] : await tx.select().from(brokerTrades).where(inArray(brokerTrades.id, [...idyTrade])).orderBy(asc(brokerTrades.entryTime));
  const ostatnie4 = new Map(kontaWPliku.map((k) => [k.brokerAccountId, k]));
  const poId = new Map(dotkniete.map((t) => [t.wiersz.id, t]));
  const dop = new Map<number, Dopasowanie>(przebieg.dopasowania.map((d) => [d.brokerTradeId, d]));
  const zast = new Map(przebieg.zastosowane.map((z) => [z.brokerTradeId, z]));
  const utw = new Set(utworzone.map((u) => u.brokerTradeId));
  const pozycje: PozycjaImportu[] = finalne.map((bt) => {
    const k = ostatnie4.get(bt.brokerAccountId);
    const d = dop.get(bt.id);
    const z = zast.get(bt.id);
    return {
      id: bt.id,
      externalRef: bt.externalRef,
      kontrakt: bt.contract,
      kierunek: bt.direction,
      ilosc: Number(bt.maxQty),
      wejscie: bt.entryTime.toISOString(),
      wyjscie: bt.exitTime?.toISOString() ?? null,
      cenaWejscia: Number(bt.avgEntryPrice),
      cenaWyjscia: bt.avgExitPrice === null ? null : Number(bt.avgExitPrice),
      status: bt.status,
      bruttoCenty: bt.grossCents,
      oplatyCenty: bt.feesCents,
      zrodloOplat: bt.feeSource,
      nettoCenty: bt.netCents,
      zrodloBrutto: bt.grossSource,
      kontoOstatnie4: k?.ostatnie4 ?? null,
      kontoDziennikaId: k?.kontoDziennikaId ?? null,
      stanDopasowania: bt.matchState,
      rodzajDopasowania: bt.matchKind,
      tradeId: bt.tradeId,
      kandydaci: d?.kandydaci ?? [],
      powod: d?.powod ?? null,
      pnlPrzed: z?.pnlPrzed ?? null,
      pnlPo: z?.pnlPo ?? null,
      nowy: poId.get(bt.id)?.nowy ?? false,
      utworzony: utw.has(bt.id),
    };
  });

  // --- liczniki importu ---
  const [{ doDecyzji }] = await tx
    .select({ doDecyzji: sql<number>`count(*)::int` })
    .from(brokerTrades)
    .where(
      and(
        inArray(brokerTrades.brokerAccountId, [...konteksty.values()].map((k) => k.id)),
        eq(brokerTrades.status, "closed"),
        inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]),
        isNull(brokerTrades.tradeId),
      ),
    );
  const otwarte = finalne.filter((t) => t.status === "open").length;
  await tx
    .update(brokerImports)
    .set({
      fillsNew: nowe.wyp,
      fillsDuplicate: nowe.dupWyp,
      tradesMatched: przebieg.zastosowane.length,
      tradesCreated: utworzone.length,
      pendingDecisions: doDecyzji,
      warnings: ostrzezenia,
    })
    .where(eq(brokerImports.id, imp.id));
  await tx.insert(authEvents).values({
    kind: "broker_import",
    tokenId: o.tokenId,
    detail: {
      importId: imp.id,
      origin: o.pochodzenie,
      format: p.format,
      fills: nowe.wyp,
      zdarzenia: nowe.zd,
      dopasowane: przebieg.zastosowane.length,
      utworzone: utworzone.length,
      doDecyzji,
    },
  });

  return {
    ok: true,
    status: "applied",
    importId: imp.id,
    sha256: sha,
    format: p.format,
    platforma,
    strefa,
    wypelnienia: { nowe: nowe.wyp, duplikaty: nowe.dupWyp },
    zdarzenia: { nowe: nowe.zd, duplikaty: nowe.dupZd },
    wiersze: wiersze(p),
    trade: { dopasowane: przebieg.zastosowane.length, doDecyzji, otwarte, utworzone: utworzone.length },
    konta: kontaWPliku,
    pozycje,
    zastosowane: przebieg.zastosowane,
    ostrzezenia,
    bledy: p.bledy,
    zaimportowanoWczesniej: null,
  };
}

/** Blad domenowy importu: transakcja jest wycofywana, a wolajacy zamienia go na odpowiedz. */
export class BladImportu extends Error {
  constructor(
    readonly status: 400 | 409 | 422,
    readonly kod: string,
    komunikat: string,
  ) {
    super(komunikat);
    this.name = "BladImportu";
  }
}

/** Trade dziennika z danych brokera: ceny, czasy i wyjscia z wypelnien; bez SL, wiec R jest puste, dopoki ktos go nie dopisze. */
export async function utworzTradeZDanychBrokera(
  tx: Transakcja,
  bt: WierszTraduBrokera,
  kontoDziennikaId: number,
  domena: { wejscia: unknown[]; wyjscia: { ilosc: number; cena: number; czas: Date }[]; sredniaCenaWejscia: number },
): Promise<{ ok: true; tradeId: number } | { ok: false; komunikat: string }> {
  if (bt.instrumentId === null) return { ok: false, komunikat: "kontrakt nie ma instrumentu w dzienniku" };
  if (bt.status !== "closed") return { ok: false, komunikat: "pozycja jest jeszcze otwarta" };
  const szkic: TradeDraft = {
    id: null,
    accountId: kontoDziennikaId,
    instrumentId: bt.instrumentId,
    backtestSessionId: null,
    direction: bt.direction,
    status: "closed",
    entryTime: bt.entryTime,
    entryPrice: Number(bt.avgEntryPrice),
    contracts: Number(bt.maxQty),
    wyjscia: domena.wyjscia.map((w, i) => ({ numer: i + 1, czas: w.czas, cena: w.cena, kontrakty: w.ilosc, kwotaBrokera: null, notatka: null })),
    stopLoss: null,
    takeProfit: null,
    mae: null,
    mfe: null,
    brokerAmount: bt.netCents,
  };
  const zapis = await persistTrade(
    szkic,
    {
      source: "broker",
      externalRef: bt.externalRef,
      sourceSnapshot: {
        brokerTradeId: bt.id,
        grossCents: bt.grossCents,
        grossSource: bt.grossSource,
        feesCents: bt.feesCents,
        feeSource: bt.feeSource,
        netCents: bt.netCents,
      },
    },
    { tx },
  );
  if (!zapis.ok) return { ok: false, komunikat: zapis.error };
  await tx
    .update(brokerTrades)
    .set({ tradeId: zapis.id, matchKind: "created", matchState: "matched", matchedAt: new Date(), prevBrokerAmountCents: null, updatedAt: new Date() })
    .where(eq(brokerTrades.id, bt.id));
  return { ok: true, tradeId: zapis.id };
}

async function podejrzeniePrzesuniecia(tx: Transakcja, kontaBrokera: number[]) {
  if (kontaBrokera.length === 0) return null;
  const bez = await tx
    .select({ bt: brokerTrades, konto: brokerAccounts.accountId })
    .from(brokerTrades)
    .innerJoin(brokerAccounts, eq(brokerTrades.brokerAccountId, brokerAccounts.id))
    .where(and(inArray(brokerTrades.brokerAccountId, kontaBrokera), eq(brokerTrades.status, "closed"), inArray(brokerTrades.matchState, ["unmatched", "ambiguous"]), isNull(brokerTrades.tradeId)));
  const wiersze = bez.filter((w) => w.konto !== null && w.bt.instrumentId !== null);
  if (wiersze.length < 2) return null;
  const minCzas = new Date(Math.min(...wiersze.map((w) => w.bt.entryTime.getTime())) - 15 * 3_600_000);
  const maxCzas = new Date(Math.max(...wiersze.map((w) => w.bt.entryTime.getTime())) + 15 * 3_600_000);
  const dziennik = await tx
    .select({ id: trades.id, accountId: trades.accountId, instrumentId: trades.instrumentId, direction: trades.direction, entryTime: trades.entryTime, contracts: trades.contracts })
    .from(trades)
    .where(
      and(
        inArray(trades.accountId, [...new Set(wiersze.map((w) => w.konto as number))]),
        isNull(trades.backtestSessionId),
        eq(trades.status, "closed"),
        gte(trades.entryTime, minCzas),
        lte(trades.entryTime, maxCzas),
        sql`not exists (select 1 from broker_trades bx where bx.trade_id = ${trades.id})`,
      ),
    );
  if (dziennik.length < 2) return null;
  return wykryjPrzesunieciaStrefy(
    wiersze.map((w) => ({ id: w.bt.id, accountId: w.konto, instrumentId: w.bt.instrumentId, direction: w.bt.direction, entryTime: w.bt.entryTime, maxQty: Number(w.bt.maxQty) })),
    dziennik.map((d) => ({ ...d, contracts: Number(d.contracts) })),
  );
}

export type WynikCofniecia =
  | { ok: true; usunieteWypelnienia: number; odpiete: number; skasowaneTrady: number; uwagi: string[] }
  | { ok: false; status: 404 | 409; komunikat: string };

/**
 * Cofniecie importu (UI, ADR-034 pkt 2): kasuje wypelnienia, zdarzenia i trade'y brokera z importu, trade'y dziennika utworzone
 * przez import kasuje BEZ nagrobka, dopasowanym przywraca poprzednia kwote z rachunku. Potem przelicza okna z tego, co zostalo
 * (pliki z innych importow), zeby trade'y brokera zgadzaly sie z pozostalymi wypelnieniami.
 */
export async function cofnijImport(tx: Transakcja, importId: number): Promise<WynikCofniecia> {
  const [imp] = await tx.select().from(brokerImports).where(eq(brokerImports.id, importId)).for("update").limit(1);
  if (!imp) return { ok: false, status: 404, komunikat: `Import #${importId} nie istnieje.` };
  if (imp.status !== "committed") {
    return { ok: false, status: 409, komunikat: `Import #${importId} ma status »${imp.status}«, a cofnąć można tylko zastosowany. Odśwież listę.` };
  }
  const { odepnijDopasowanie } = await import("./dopasowania");

  // co zostanie dotkniete: konta, kontrakty i najwczesniejsze czasy wypelnien i zdarzen tego importu
  const wyp = await tx.select().from(brokerFills).where(eq(brokerFills.importId, importId));
  const zd = await tx.select().from(brokerCashEvents).where(eq(brokerCashEvents.importId, importId));
  const grupy = new Map<string, { kontoId: number; kontrakt: string; czas: Date }>();
  const dotknij = (kontoId: number, kontrakt: string, czas: Date): void => {
    const k = `${kontoId}|${kontrakt}`;
    const j = grupy.get(k);
    if (!j || czas.getTime() < j.czas.getTime()) grupy.set(k, { kontoId, kontrakt, czas });
  };
  for (const w of wyp) dotknij(w.brokerAccountId, w.contract, w.filledAt);
  for (const z of zd) if (z.contract !== null) dotknij(z.brokerAccountId, z.contract, z.occurredAt);

  // trade'y brokera utworzone przez ten import: odpinamy (utworzone w dzienniku kasujemy bez nagrobka)
  const swoje = await tx.select().from(brokerTrades).where(eq(brokerTrades.importId, importId));
  const uwagi: string[] = [];
  let odpiete = 0;
  let skasowane = 0;
  for (const bt of swoje) {
    if (bt.tradeId === null) continue;
    const w = await odepnijDopasowanie(tx, bt, { nowyStan: "unmatched", przywrocKwote: true });
    odpiete += 1;
    if (w.skasowanoTrade) skasowane += 1;
    if (w.uwaga) uwagi.push(w.uwaga);
  }
  await tx.delete(brokerTrades).where(eq(brokerTrades.importId, importId));
  await tx.delete(brokerFills).where(eq(brokerFills.importId, importId));
  await tx.delete(brokerCashEvents).where(eq(brokerCashEvents.importId, importId));

  // przeliczenie okien z pozostalych danych
  const konta = new Map<number, KontoBrokeraKontekst>();
  for (const g of grupy.values()) {
    let k = konta.get(g.kontoId);
    if (!k) {
      const [ba] = await tx.select().from(brokerAccounts).where(eq(brokerAccounts.id, g.kontoId)).limit(1);
      if (!ba) continue;
      k = { id: ba.id, platforma: ba.platform, krotki: ba.externalAccountHmac.slice(0, 12), kontoDziennikaId: ba.accountId };
      konta.set(g.kontoId, k);
    }
    const start = await poczatekOkna(tx, k.id, g.kontrakt, g.czas);
    await przeliczOkno(tx, k, g.kontrakt, start, null);
  }

  await tx.update(brokerImports).set({ status: "reverted", revertedAt: new Date() }).where(eq(brokerImports.id, importId));
  await tx.insert(authEvents).values({ kind: "broker_import_reverted", detail: { importId, wypelnienia: wyp.length, odpiete, skasowaneTrady: skasowane } });
  return { ok: true, usunieteWypelnienia: wyp.length, odpiete, skasowaneTrady: skasowane, uwagi };
}

/**
 * Odtwarza dane wypelnien trade'a brokera (wejscia, wyjscia, srednie) z zapisanych wypelnien: grupuje okno od trade'a
 * poprzedzajacego (wspolne wypelnienie przy odwroceniu) i wybiera trade o tym samym kluczu. Uzywane, gdy trade dziennika ma
 * powstac z trade'a brokera POZNIEJ niz import (zatwierdzenie sugestii `broker_trade`).
 */
export async function domenaTraduBrokera(tx: Transakcja, bt: WierszTraduBrokera) {
  const [ba] = await tx.select().from(brokerAccounts).where(eq(brokerAccounts.id, bt.brokerAccountId)).limit(1);
  if (!ba) return null;
  const konto: KontoBrokeraKontekst = { id: ba.id, platforma: ba.platform, krotki: ba.externalAccountHmac.slice(0, 12), kontoDziennikaId: ba.accountId };
  const [poprzedni] = await tx
    .select({ entryTime: brokerTrades.entryTime })
    .from(brokerTrades)
    .where(and(eq(brokerTrades.brokerAccountId, bt.brokerAccountId), eq(brokerTrades.contract, bt.contract), lt(brokerTrades.entryTime, bt.entryTime), gte(brokerTrades.exitTime, bt.entryTime)))
    .orderBy(asc(brokerTrades.entryTime))
    .limit(1);
  const dom = await wczytajDomene(tx, konto, bt.contract, poprzedni?.entryTime ?? bt.entryTime);
  const prefiks = `brk:${prefiksWypelnien(konto)}`;
  return dom.trade.find((t) => `${prefiks}${t.klucz}` === bt.externalRef) ?? null;
}
