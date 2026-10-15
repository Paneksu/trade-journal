import "server-only";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "@/lib/db";
import { ruleVersions, rules, screenshots, settings, tradeReviews, tradeRuleChecks, trades } from "@/lib/db/schema";
import { kanonicznyJson } from "@/lib/domain/kanoniczny";
import { moglZnacDzien } from "@/lib/domain/lookahead";

import type { KorektaWerdyktuSchema } from "./contract/funkcje";
import type { OcenaSchema } from "./contract/schemas";
import { skrotTekstu } from "./skrot";
import { wejscieTradu } from "./ukrycie-wyniku";
import type { Zapis } from "./zapis";
import type { Transakcja } from "./with-api";

/**
 * Ocena trade'a przez AI. Dwa tryby:
 *
Od 15.10.2026 (Slowa uzytkownika: «Niezmienny zawsze») KAZDY werdykt jest niezmienny, takze bez pola `evidence`
 * (dawny tryb ADR-028 z podmiana oceny zostal usuniety; werdykty sprzed zmiany, bez as_of, zostaja czytelne).
 * WERDYKT NIEZMIENNY (ADR-033, MUST 2): z polem `evidence` (swiece OHLC + sha256 zrzutow) albo bez niego (pusty manifest).
 *    Serwer stawia `as_of` (czas zegarowy wydania), liczy `evidence_hash` z kanonicznego JSON-a
 *    dowodow i zapisuje zestaw regul. Od tej chwili baza nie pozwala zmienic werdyktu
 *    (trigger, TJ409): ponowne wyslanie tej SAMEJ tresci to to samo (200), innej to 409, a
 *    zdanie uzytkownika, ze sie nie zgadza, to korekta `user_override` - NOWY wiersz, stary
 *    zostaje. Ocena `chart` nie moze widziec swiec pozniejszych niz wejscie.
 *
 * Zdanie uzytkownika ("zgadzam sie / nie zgadzam sie" z ocena reguly) jest jego wlasnoscia,
 * nie klienta - to jedyna kolumna werdyktu, ktora wolno zmienic po `as_of` (w aplikacji).
 */

export type WynikOceny =
  | {
      ok: true;
      reviewId: number;
      created: boolean;
      ruleChecks: number;
      userVerdictsKept: number;
      immutable: boolean;
      asOf: string | null;
      evidenceHash: string | null;
      evidenceCutoff: string | null;
      rulesetVersion: number | null;
      unknownRules: string[];
      lookAhead: { moglZnacDzien: boolean; powod: string } | null;
    }
  | { ok: false; status: 404 | 409 | 422; kod?: string; komunikat: string; dodatkowe?: Record<string, unknown> };

const KOD_REGULY = /^R-\d{3,}$/;

export async function zapiszOcene(
  tradeId: number,
  o: z.output<typeof OcenaSchema>,
  zapis: Zapis,
  tokenId: number | null = null,
): Promise<WynikOceny> {
  const [trade] = await db
    .select({ id: trades.id, entryTime: trades.entryTime, tradingDay: trades.tradingDay })
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!trade) {
    return {
      ok: false,
      status: 404,
      komunikat: `Trade #${tradeId} nie istnieje (mógł zostać skasowany w aplikacji). Sprawdź id w odpowiedzi POST /api/ingest/trades albo w GET /api/ingest/trades.`,
    };
  }
  // Kazdy werdykt AI jest niezmienny, takze bez `evidence` (Slowa uzytkownika 15.10.2026: «Niezmienny zawsze»).
  return zapiszWerdyktNiezmienny(trade, o, zapis, tokenId);
}

/* --- Werdykt niezmienny ---------------------------------------------------------------------- */

type TradeDlaWerdyktu = { id: number; entryTime: Date; tradingDay: string | null };

/** Wersja reguly obowiazujaca w zestawie `V`: najnowsza zatwierdzona (lub pozniej zastapiona) z numerem zestawu <= V. */
async function wersjaRegulyWZestawie(tx: Transakcja, kod: string, zestaw: number): Promise<number | null> {
  const [w] = await tx
    .select({ id: ruleVersions.id })
    .from(ruleVersions)
    .innerJoin(rules, eq(ruleVersions.ruleId, rules.id))
    .where(
      and(
        eq(rules.code, kod),
        or(eq(ruleVersions.status, "approved"), eq(ruleVersions.status, "superseded")),
        lte(ruleVersions.rulesetVersion, zestaw),
      ),
    )
    .orderBy(desc(ruleVersions.rulesetVersion))
    .limit(1);
  return w?.id ?? null;
}

type SpisRegul = { ruleId: string; ruleText: string; verdict: "pass" | "fail" | "na" | "unclear"; evidence?: string | null | undefined };

function odciskTresci(w: {
  basis: string;
  setupType: string | null;
  summaryMd: string | null;
  lesson: string | null;
  brainVerdict: string | null;
  brainPlan: unknown;
  model: string | null;
  evidenceHash: string;
  reguly: SpisRegul[];
}): string {
  return skrotTekstu(
    kanonicznyJson({
      basis: w.basis,
      setupType: w.setupType,
      summaryMd: w.summaryMd,
      lesson: w.lesson,
      brainVerdict: w.brainVerdict,
      brainPlan: w.brainPlan ?? null,
      model: w.model,
      evidenceHash: w.evidenceHash,
      reguly: [...w.reguly]
        .sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0))
        .map((r) => ({ ruleId: r.ruleId, ruleText: r.ruleText, verdict: r.verdict, evidence: r.evidence ?? null })),
    }),
  );
}

async function zapiszWerdyktNiezmienny(
  trade: TradeDlaWerdyktu,
  o: z.output<typeof OcenaSchema>,
  zapis: Zapis,
  tokenId: number | null,
): Promise<WynikOceny> {
  // Bez `evidence` werdykt tez jest niezmienny (as_of + skrot pustego manifestu); nie ma wtedy swiec ani zrzutow do sprawdzenia,
  // wiec kontrola look-ahead dotyczy tylko tego, co przyslano (evidenceCutoff).
  const dowod = o.evidence ?? { candles: [], screenshots: [] as { sha256: string }[], intervalMinutes: undefined as number | undefined };
  const swiece = [...dowod.candles].sort((a, b) => a.t.getTime() - b.t.getTime());
  const najpozniejsza = swiece.length > 0 ? swiece[swiece.length - 1].t : null;

  // Wejscie = najwczesniejsze znane (least z czasem przypiecia planu), jak w calej slepej ocenie (review 15.10.2026, B4):
  // pozniejsza edycja entry_time nie moze poluzowac kontroli look-ahead.
  const wejscie = (await wejscieTradu(db, trade.id)) ?? trade.entryTime;
  // "Zero zagladania": ocena z wykresu na moment decyzji nie moze widziec swiecy pozniejszych niz wejscie.
  // Swieca (`t` = czas otwarcia) musi sie skonczyc najpozniej w chwili wejscia: t + interwal <= entryTime.
  const interwalMs = (dowod.intervalMinutes ?? 0) * 60_000;
  const koniecNajpozniejszej = najpozniejsza === null ? 0 : najpozniejsza.getTime() + interwalMs;
  if (najpozniejsza !== null && o.basis === "chart" && koniecNajpozniejszej > wejscie.getTime()) {
    return {
      ok: false,
      status: 422,
      kod: "look_ahead",
      komunikat: `pole evidence.candles: świeca otwarta ${najpozniejsza.toISOString()} (${dowod.intervalMinutes ?? 0} min) kończy się ${new Date(koniecNajpozniejszej).toISOString()}, a wejście było ${wejscie.toISOString()}. Ocena »chart« ma powstać na moment decyzji i nie wolno jej widzieć przyszłości (świeca musi się skończyć najpóźniej w chwili wejścia); ocenę po fakcie wyślij z basis = history.`,
    };
  }
  if (o.basis === "chart" && o.evidenceCutoff && o.evidenceCutoff.getTime() > wejscie.getTime()) {
    return {
      ok: false,
      status: 422,
      kod: "look_ahead",
      komunikat: `pole evidenceCutoff: ${o.evidenceCutoff.toISOString()} jest późniejsze niż wejście (${wejscie.toISOString()}). Przy ocenie »chart« odcięcie danych nie może wybiegać poza moment decyzji.`,
    };
  }
  const odciecie = o.evidenceCutoff ?? najpozniejsza;
  if (najpozniejsza !== null && odciecie !== null && najpozniejsza.getTime() > odciecie.getTime()) {
    return {
      ok: false,
      status: 422,
      kod: "look_ahead",
      komunikat: `pole evidenceCutoff: ${odciecie.toISOString()} jest wcześniejsze niż najpóźniejsza przekazana świeca (${najpozniejsza.toISOString()}). Odcięcie danych musi obejmować wszystko, co AI widziało.`,
    };
  }

  const sha = [...new Set(dowod.screenshots.map((s) => s.sha256))].sort();
  if (sha.length > 0) {
    const znalezione = await db
      .select({ sha256: screenshots.sha256, capturedAt: screenshots.capturedAt })
      .from(screenshots)
      .where(and(eq(screenshots.tradeId, trade.id), inArray(screenshots.sha256, sha)));
    // Ocena »chart« nie moze opierac sie na zrzucie zrobionym PO wejsciu (audyt N3, 15.10.2026): pokazuje przyszlosc.
    const poWejsciu = o.basis === "chart" ? znalezione.filter((z) => z.capturedAt === null || z.capturedAt.getTime() > wejscie.getTime()) : [];
    if (poWejsciu.length > 0) {
      return {
        ok: false,
        status: 422,
        kod: "look_ahead",
        komunikat: `pole evidence.screenshots: zrzut sha256 ${poWejsciu.map((z) => `»${z.sha256}« (${z.capturedAt === null ? "bez znacznika czasu zrobienia" : `zrobiony ${z.capturedAt.toISOString()}`})`).join(", ")} nie ma dowodu, że powstał przed wejściem (${wejscie.toISOString()}): jest zrobiony po wejściu albo bez znacznika czasu. Ocena »chart« ma powstać na moment decyzji; zrzut z czasu po wejściu dołącz do oceny z basis = history.`,
        dodatkowe: { afterEntry: poWejsciu.map((z) => z.sha256) },
      };
    }
    const maja = new Set(znalezione.map((z) => z.sha256));
    const brak = sha.filter((s) => !maja.has(s));
    if (brak.length > 0) {
      return {
        ok: false,
        status: 422,
        kod: "unknown_screenshot",
        komunikat: `pole evidence.screenshots: sha256 ${brak.map((b) => `»${b}«`).join(", ")} nie należy do żadnego zrzutu trade'a #${trade.id}. Wyślij zrzuty (POST /api/v2/trades/${trade.id}/screenshots) przed werdyktem i podaj skróty z ich odpowiedzi.`,
        dodatkowe: { missing: brak },
      };
    }
  }

  const manifest = {
    ...(dowod.intervalMinutes !== undefined ? { intervalMinutes: dowod.intervalMinutes } : {}),
    candles: swiece.map((s) => ({ t: s.t.toISOString(), o: s.o, h: s.h, l: s.l, c: s.c })),
    screenshots: sha.map((s) => ({ sha256: s })),
  };
  const evidenceHash = skrotTekstu(kanonicznyJson(manifest));
  const modelOdp = moglZnacDzien(o.model ?? null, trade.tradingDay ?? trade.entryTime.toISOString().slice(0, 10));

  return zapis(async (tx) => {
    const [ust] = await tx.select({ v: settings.rulesetVersion }).from(settings).where(eq(settings.id, 1)).limit(1);
    const biezacy = ust?.v ?? 0;
    const zestaw = o.rulesetVersion ?? biezacy;
    if (zestaw > biezacy) {
      return { ok: false as const, status: 422 as const, kod: "unknown_ruleset", komunikat: `pole rulesetVersion: ${zestaw} jest większy niż bieżący numer zestawu reguł (${biezacy}); odczytaj go z GET /api/v2/rules (rulesVersion).` };
    }

    const [istniejacy] = await tx
      .select()
      .from(tradeReviews)
      .where(and(eq(tradeReviews.tradeId, trade.id), eq(tradeReviews.basis, o.basis), eq(tradeReviews.kind, "ai")))
      .limit(1);

    // Rozwiazanie wersji regul: kod R-xxx -> wersja obowiazujaca w zestawie.
    const wersje = new Map<string, number | null>();
    const nieznane: string[] = [];
    for (const r of o.ruleChecks) {
      if (!KOD_REGULY.test(r.ruleId)) {
        nieznane.push(r.ruleId);
        wersje.set(r.ruleId, null);
        continue;
      }
      const id = await wersjaRegulyWZestawie(tx, r.ruleId, zestaw);
      wersje.set(r.ruleId, id);
      if (id === null) nieznane.push(r.ruleId);
    }

    const spis: SpisRegul[] = o.ruleChecks;
    const tresc = {
      basis: o.basis,
      setupType: o.setupType ?? null,
      summaryMd: o.summaryMd ?? null,
      lesson: o.lesson ?? null,
      brainVerdict: o.brainVerdict ?? null,
      brainPlan: o.brainPlan ?? null,
      model: o.model ?? null,
      evidenceHash,
      reguly: spis,
    };

    const odpowiedz = (id: number, utworzony: boolean, asOf: Date | null, zachowane: number) => ({
      ok: true as const,
      reviewId: id,
      created: utworzony,
      ruleChecks: o.ruleChecks.length,
      userVerdictsKept: zachowane,
      immutable: true,
      asOf: asOf?.toISOString() ?? null,
      evidenceHash,
      evidenceCutoff: odciecie?.toISOString() ?? null,
      rulesetVersion: zestaw,
      unknownRules: nieznane,
      lookAhead: modelOdp,
    });

    let zachowaneZdania = new Map<string, "agree" | "disagree" | null>();
    if (istniejacy) {
      const sprawdzenia = await tx.select().from(tradeRuleChecks).where(eq(tradeRuleChecks.reviewId, istniejacy.id));
      if (istniejacy.asOf !== null) {
        // Ten sam werdykt wyslany ponownie (retry po zerwaniu polaczenia) to ten sam werdykt.
        const poprzedniOdcisk = odciskTresci({
          basis: istniejacy.basis,
          setupType: istniejacy.setupType,
          summaryMd: istniejacy.summaryMd,
          lesson: istniejacy.lesson,
          brainVerdict: istniejacy.brainVerdict,
          brainPlan: istniejacy.brainPlan,
          model: istniejacy.model,
          evidenceHash: istniejacy.evidenceHash ?? "",
          reguly: sprawdzenia.map((s) => ({ ruleId: s.ruleId, ruleText: s.ruleText, verdict: s.verdict, evidence: s.evidence })),
        });
        if (poprzedniOdcisk === odciskTresci(tresc)) return odpowiedz(istniejacy.id, false, istniejacy.asOf, 0);
        return {
          ok: false as const,
          status: 409 as const,
          kod: "verdict_immutable",
          komunikat: `Trade #${trade.id} ma już niezmienny werdykt AI »${o.basis}« wydany ${istniejacy.asOf.toISOString()} (dowody ${istniejacy.evidenceHash?.slice(0, 12)}…). Treść wysłana teraz jest inna, a werdykt z as_of nie podlega podmianie. Jeśli to korekta użytkownika, zapisz ją jako user_override: POST /api/v2/trades/${trade.id}/reviews/${istniejacy.id}/override.`,
          dodatkowe: { reviewId: istniejacy.id, asOf: istniejacy.asOf.toISOString() },
        };
      }
      // Stary werdykt bez as_of: zastepujemy go niezmiennym, zachowujac zdania uzytkownika o niezmienionych werdyktach regul.
      zachowaneZdania = new Map(sprawdzenia.map((s) => [`${s.ruleId}|${s.verdict}`, s.userVerdict]));
      await tx.delete(tradeReviews).where(eq(tradeReviews.id, istniejacy.id));
    }

    const [wiersz] = await tx
      .insert(tradeReviews)
      .values({
        tradeId: trade.id,
        basis: o.basis,
        setupType: o.setupType ?? null,
        summaryMd: o.summaryMd ?? null,
        lesson: o.lesson ?? null,
        brainVerdict: o.brainVerdict ?? null,
        brainPlan: o.brainPlan ?? null,
        brainVersion: o.brainVersion ?? null,
        evidenceCutoff: odciecie,
        model: o.model ?? null,
        kind: "ai",
        asOf: sql`now()` as unknown as Date,
        evidenceHash,
        evidenceManifest: manifest,
        rulesetVersion: zestaw,
        createdByTokenId: tokenId,
      })
      .returning({ id: tradeReviews.id, asOf: tradeReviews.asOf });

    let zachowane = 0;
    for (const r of o.ruleChecks) {
      const zdanie = zachowaneZdania.get(`${r.ruleId}|${r.verdict}`) ?? null;
      if (zdanie) zachowane += 1;
      await tx.insert(tradeRuleChecks).values({
        reviewId: wiersz.id,
        ruleId: r.ruleId,
        ruleText: r.ruleText,
        verdict: r.verdict,
        evidence: r.evidence ?? null,
        userVerdict: zdanie,
        ruleVersionId: wersje.get(r.ruleId) ?? null,
      });
    }
    return odpowiedz(wiersz.id, true, wiersz.asOf, zachowane);
  });
}

/* --- Korekta uzytkownika (user_override) ----------------------------------------------------------- */

export type WynikKorekty =
  | { ok: true; reviewId: number; overridesReviewId: number; asOf: string | null; evidenceHash: string; ruleChecks: number; utworzona: boolean }
  | { ok: false; status: 404 | 422; kod: string; komunikat: string };

export async function zapiszKorekte(
  tradeId: number,
  reviewId: number,
  d: z.output<typeof KorektaWerdyktuSchema>,
  zapis: Zapis,
  tokenId: number | null,
): Promise<WynikKorekty> {
  return zapis(async (tx) => {
    const [oryginal] = await tx.select().from(tradeReviews).where(and(eq(tradeReviews.id, reviewId), eq(tradeReviews.tradeId, tradeId))).limit(1);
    if (!oryginal) {
      return { ok: false as const, status: 404 as const, kod: "not_found", komunikat: `Werdykt #${reviewId} nie należy do trade'a #${tradeId} albo nie istnieje.` };
    }
    if (oryginal.kind !== "ai") {
      return { ok: false as const, status: 422 as const, kod: "not_ai_verdict", komunikat: `Werdykt #${reviewId} to korekta użytkownika. Koryguje się werdykty AI; kolejną korektę wskaż na pierwotnym werdykcie AI (#${oryginal.overridesReviewId}).` };
    }
    const [slowa] = await tx.execute<{ id: number; trade_id: number | null; day: string | null }>(sql`select id, trade_id, day::text as day from user_words where id = ${d.wordsId}`);
    if (!slowa) {
      return { ok: false as const, status: 422 as const, kod: "unknown_reference", komunikat: `pole wordsId: słowa użytkownika #${d.wordsId} nie istnieją (zapisz je najpierw przez POST /api/v2/user-words).` };
    }
    // Korekta werdyktu musi stac na slowach o TYM trade'u albo jego dniu handlowym (audyt 3): cudze slowa
    // z innego dnia nie uzasadniaja korekty i zaciemniaja, kto i dlaczego zmienil ocene.
    const [tr] = await tx.select({ tradingDay: trades.tradingDay }).from(trades).where(eq(trades.id, tradeId)).limit(1);
    const dzienTradu = tr?.tradingDay ?? null;
    if (slowa.trade_id !== tradeId && !(slowa.trade_id === null && slowa.day !== null && slowa.day === dzienTradu)) {
      return {
        ok: false as const,
        status: 422 as const,
        kod: "words_not_for_trade",
        komunikat: `pole wordsId: słowa #${d.wordsId} nie dotyczą trade'a #${tradeId} (mają trade ${slowa.trade_id ?? "brak"}, dzień ${slowa.day ?? "brak"}; dzień handlowy trade'a: ${dzienTradu ?? "brak"}). Zapisz uzasadnienie korekty z tradeId = ${tradeId} albo z day = ${dzienTradu ?? "dniem trade'a"} (POST /api/v2/user-words).`,
      };
    }

    const stare = await tx.select().from(tradeRuleChecks).where(eq(tradeRuleChecks.reviewId, oryginal.id)).orderBy(asc(tradeRuleChecks.ruleId));
    const manifest = {
      overrides: { reviewId: oryginal.id, evidenceHash: oryginal.evidenceHash },
      wordsId: d.wordsId,
      setupType: d.setupType === undefined ? null : d.setupType,
      summaryMd: d.summaryMd === undefined ? null : d.summaryMd,
      lesson: d.lesson === undefined ? null : d.lesson,
      brainVerdict: d.brainVerdict === undefined ? oryginal.brainVerdict : d.brainVerdict,
      ruleChecks: d.ruleChecks.length > 0 ? d.ruleChecks.map((r) => ({ ruleId: r.ruleId, verdict: r.verdict })) : "bez zmian",
    };
    const evidenceHash = skrotTekstu(kanonicznyJson(manifest));
    const [ust] = await tx.select({ v: settings.rulesetVersion }).from(settings).where(eq(settings.id, 1)).limit(1);

    // Idempotencja (review P5): ta sama korekta (werdykt, slowa, tresc) wyslana ponownie to ten sam wiersz (200).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tj.override:${oryginal.id}:${evidenceHash}`}, 0))`);
    const [juz] = await tx
      .select({ id: tradeReviews.id, asOf: tradeReviews.asOf })
      .from(tradeReviews)
      .where(and(eq(tradeReviews.overridesReviewId, oryginal.id), eq(tradeReviews.kind, "user_override"), eq(tradeReviews.evidenceHash, evidenceHash)))
      .limit(1);
    if (juz) {
      const [{ ile }] = await tx.select({ ile: sql<number>`count(*)::int` }).from(tradeRuleChecks).where(eq(tradeRuleChecks.reviewId, juz.id));
      return { ok: true as const, reviewId: juz.id, overridesReviewId: oryginal.id, asOf: juz.asOf?.toISOString() ?? null, evidenceHash, ruleChecks: ile, utworzona: false };
    }

    const [nowy] = await tx
      .insert(tradeReviews)
      .values({
        tradeId,
        basis: oryginal.basis,
        setupType: d.setupType === undefined ? oryginal.setupType : d.setupType,
        summaryMd: d.summaryMd === undefined ? oryginal.summaryMd : d.summaryMd,
        lesson: d.lesson === undefined ? oryginal.lesson : d.lesson,
        brainVerdict: d.brainVerdict === undefined ? oryginal.brainVerdict : d.brainVerdict,
        brainPlan: oryginal.brainPlan,
        brainVersion: oryginal.brainVersion,
        evidenceCutoff: oryginal.evidenceCutoff,
        model: "user_override",
        kind: "user_override",
        overridesReviewId: oryginal.id,
        asOf: sql`now()` as unknown as Date,
        evidenceHash,
        evidenceManifest: manifest,
        rulesetVersion: oryginal.rulesetVersion ?? ust?.v ?? 0,
        createdByTokenId: tokenId,
      })
      .returning({ id: tradeReviews.id, asOf: tradeReviews.asOf });

    const nowe = d.ruleChecks.length > 0 ? d.ruleChecks.map((r) => ({ ruleId: r.ruleId, ruleText: r.ruleText, verdict: r.verdict, evidence: r.evidence ?? null, ruleVersionId: stare.find((s) => s.ruleId === r.ruleId)?.ruleVersionId ?? null })) : stare.map((s) => ({ ruleId: s.ruleId, ruleText: s.ruleText, verdict: s.verdict, evidence: s.evidence, ruleVersionId: s.ruleVersionId }));
    for (const r of nowe) {
      await tx.insert(tradeRuleChecks).values({ reviewId: nowy.id, ...r, userVerdict: null });
    }
    return { ok: true as const, reviewId: nowy.id, overridesReviewId: oryginal.id, asOf: nowy.asOf?.toISOString() ?? null, evidenceHash, ruleChecks: nowe.length, utworzona: true };
  });
}
