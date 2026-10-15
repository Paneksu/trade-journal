/**
 * Moduł prop (ADR-033, MUST 7; metodyka R29, R30): bufory do limitów, ostrzeżenia
 * 50/75/90%, consistency, bufor "gdy trafi SL" i laczna ekspozycja NQ.
 *
 * Modul czysty: dostaje reguly konta (kopia presetu z mozliwoscia nadpisania),
 * saldo startowe i liste zamknietych trade'ow, zwraca stan. ZADNYCH blokad -
 * AI nie sklada zlecen, wiec blokady nie da sie wymusic; sa tylko ostrzezenia.
 *
 * Wszystkie kwoty w CENTACH (liczby calkowite). Ryzyko planu (`ryzykoPlanuCents`)
 * pochodzi z `computeTrade` (`riskAmount`), NIGDY z mnozenia tickow przez
 * wartosc ticku tutaj: tick instrumentu jest w tysiecznych USD (ADR-002), a
 * kolejnosc zaokraglen zmienia wynik (ZN: 15,625 USD nie jest calkowite w centach).
 *
 * Model drawdownu (jedna formula dla czterech typow):
 *     prog = saldo_start + min(zysk_szczytowy, zysk_blokady) - max_dd
 *     bufor = saldo_biezace - prog
 *  - `static`: zysk_blokady = 0, prog stoi w miejscu (start - max_dd);
 *  - `eod`: trailing od najwyzszego salda NA KONIEC DNIA (dni zakonczone, bez
 *    biezacego), bez blokady;
 *  - `intraday`: trailing od najwyzszego salda po ktorymkolwiek zamknietym
 *    trade'cie (szczyt z niezrealizowanym P/L nie jest znany dzienniku);
 *  - `trailing_to_static`: trailing (podstawa EOD albo intraday z `extra.trail_basis`)
 *    do zysku_blokady = `dd_lock_cents`, potem prog stoi.
 * Szczyt intraday liczony ze zrealizowanych trade'ow jest ZANIZONY wzgledem
 * szczytu firmy (ten uwzglednia otwarte pozycje), wiec bufor jest ZAWYZONY.
 * Wynik niesie o tym uwage w `uwagi`.
 */

export const TYPY_DD = ["eod", "intraday", "static", "trailing_to_static"] as const;
export type TypDd = (typeof TYPY_DD)[number];

export type PodstawaTrailingu = "eod" | "intraday";

export type ZasadyKonta = {
  ddType: TypDd;
  maxDdCents: number;
  /** Zysk szczytowy (od salda startowego), przy ktorym prog DD przestaje rosnac. */
  ddLockCents: number | null;
  /** Obowiazkowy dzienny limit straty; `null` = brak albo opcjonalny i niewybrany. */
  dailyLossCents: number | null;
  profitTargetCents: number | null;
  consistencyPct: number | null;
  minDays: number | null;
  maxContractsMini: number | null;
  maxContractsMicro: number | null;
  /** Kopia `extra` presetu: trail_basis, consistency_basis, consistency_effect, lock_rule, dll_optional_usd... */
  extra: Record<string, unknown>;
};

export type TransakcjaKonta = {
  /** Dzien handlowy YYYY-MM-DD. */
  dzien: string;
  /** Czas zamkniecia (do kolejnosci w ramach dnia); `null` = brak, kolejnosc z listy. */
  czas: Date | null;
  pnlCents: number;
};

/* ---------------------------------------------------------------------------
   Pomocnicze
   --------------------------------------------------------------------------- */

/** "1234567" -> "12 345,67 USD". */
export function kwotaUsd(cents: number): string {
  const znak = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const calosc = Math.floor(abs / 100);
  const grosze = String(abs % 100).padStart(2, "0");
  return `${znak}${String(calosc).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${grosze} USD`;
}

const procent = (x: number) => `${Math.round(x * 100)}%`;

function tekstEx(extra: Record<string, unknown>, klucz: string): string | null {
  const w = extra[klucz];
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

/**
 * Podstawa trailingu. `pewna = false`, gdy preset jej nie podaje albo daje wybor
 * przy zakupie ("eod lub intraday"): wtedy bierzemy wariant OSTROZNIEJSZY (intraday).
 */
export function podstawaTrailingu(ddType: TypDd, extra: Record<string, unknown>): { podstawa: PodstawaTrailingu; pewna: boolean } {
  if (ddType === "eod") return { podstawa: "eod", pewna: true };
  if (ddType === "intraday") return { podstawa: "intraday", pewna: true };
  if (ddType === "static") return { podstawa: "eod", pewna: true };
  const t = tekstEx(extra, "trail_basis")?.toLowerCase() ?? null;
  if (t === null) return { podstawa: "intraday", pewna: false };
  if (t.includes(" lub ")) return { podstawa: "intraday", pewna: false };
  if (t.startsWith("eod")) return { podstawa: "eod", pewna: true };
  if (t.startsWith("intraday")) return { podstawa: "intraday", pewna: true };
  return { podstawa: "intraday", pewna: false };
}

/* ---------------------------------------------------------------------------
   Consistency: trzy znaczenia podstawy i trzy skutki
   --------------------------------------------------------------------------- */

export type PodstawaConsistency = "total" | "goal" | "cycle";
export type SkutekConsistency = "fail" | "raise_target" | "block_payout" | "brak" | "nieznany";

export const PODSTAWA_CONSISTENCY_NAZWY: Record<PodstawaConsistency, string> = {
  total: "największy dzień / łączny zysk",
  goal: "największy dzień / cel zysku",
  cycle: "największy dzień / zysk od ostatniej wypłaty",
};

export const SKUTEK_CONSISTENCY_NAZWY: Record<SkutekConsistency, string> = {
  fail: "oblewa ocenę",
  raise_target: "podnosi cel zysku (nie oblewa)",
  block_payout: "blokuje wypłatę",
  brak: "bez skutku (informacyjnie)",
  nieznany: "skutek nieznany (sprawdź regulamin)",
};

/**
 * Znaczenie consistency z `extra` presetu. Jawne pola maszynowe
 * `consistency_basis_kind` / `consistency_effect_kind` (ustawiane przez
 * uzytkownika, gdy nadpisuje preset) wygrywaja z opisem tekstowym presetu.
 */
export function znaczenieConsistency(extra: Record<string, unknown>): { podstawa: PodstawaConsistency; skutek: SkutekConsistency; pewne: boolean } {
  const jawnaPodstawa = tekstEx(extra, "consistency_basis_kind");
  const jawnySkutek = tekstEx(extra, "consistency_effect_kind");

  const opisPodstawy = (tekstEx(extra, "consistency_basis") ?? "").toLowerCase();
  let podstawa: PodstawaConsistency = "total";
  let podstawaPewna = opisPodstawy !== "";
  if (jawnaPodstawa === "total" || jawnaPodstawa === "goal" || jawnaPodstawa === "cycle") {
    podstawa = jawnaPodstawa;
    podstawaPewna = true;
  } else if (/\bcelu\b|celu zysku|cel zysku/.test(opisPodstawy) && !/łączn|laczn/.test(opisPodstawy)) {
    podstawa = "goal";
  } else if (/ostatni\w* (wypłat|żądani)|w cyklu|między żądaniami|reset po wypłacie|od ostatniej wypłaty/.test(opisPodstawy)) {
    podstawa = "cycle";
  }

  const opisSkutku = (tekstEx(extra, "consistency_effect") ?? "").toLowerCase();
  let skutek: SkutekConsistency = "nieznany";
  let skutekPewny = opisSkutku !== "";
  if (jawnySkutek === "fail" || jawnySkutek === "raise_target" || jawnySkutek === "block_payout" || jawnySkutek === "brak") {
    skutek = jawnySkutek;
    skutekPewny = true;
  } else if (opisSkutku.startsWith("fail")) skutek = "fail";
  else if (opisSkutku.startsWith("raise_target")) skutek = "raise_target";
  else if (opisSkutku.startsWith("block_payout")) skutek = "block_payout";
  else if (opisSkutku.startsWith("nie oblewa")) skutek = "brak";
  return { podstawa, skutek, pewne: podstawaPewna && skutekPewny };
}

export type StanConsistency = {
  pct: number;
  podstawa: PodstawaConsistency;
  skutek: SkutekConsistency;
  /** Znaczenie wyczytane z opisu presetu bez pewnosci (sprawdz w regulaminie). */
  pewne: boolean;
  najlepszyDzienCents: number;
  /** Mianownik udzialu: lacznie zysk netto (total, cycle) albo cel zysku (goal). `null` = nie da sie policzyc. */
  mianownikCents: number | null;
  /** 0..1+; `null`, gdy brak mianownika albo zysku. */
  udzial: number | null;
  naruszona: boolean;
  /** >= 90% progu. */
  naGranicy: boolean;
  /** raise_target: cel zysku po podniesieniu (najlepszy dzien / pct). */
  wymaganyCelCents: number | null;
  /** Ile dzisiejszego zysku mozna jeszcze zrobic, zeby dzis nie zlamal zasady; ujemne = juz zlamana. */
  zostaloDzisCents: number | null;
};

function liczConsistency(
  zasady: ZasadyKonta,
  dniPnl: ReadonlyMap<string, number>,
  dzis: string | null,
): StanConsistency | null {
  if (zasady.consistencyPct === null) return null;
  const pct = zasady.consistencyPct;
  const { podstawa, skutek, pewne } = znaczenieConsistency(zasady.extra);
  const wartosci = [...dniPnl.values()];
  const najlepszy = wartosci.length > 0 ? Math.max(0, ...wartosci) : 0;
  const zysk = wartosci.reduce((s, x) => s + x, 0);

  const mianownik = podstawa === "goal" ? zasady.profitTargetCents : zysk > 0 ? zysk : null;
  const udzial = mianownik !== null && mianownik > 0 ? najlepszy / mianownik : null;
  const prog = pct / 100;
  const naruszona = udzial !== null && udzial > prog;
  const naGranicy = udzial !== null && udzial >= prog * 0.9;

  const wymaganyCelCents =
    skutek === "raise_target" && najlepszy > 0 && prog > 0 ? Math.ceil(najlepszy / prog) : null;

  let zostaloDzisCents: number | null = null;
  if (dzis !== null) {
    const dzisiaj = dniPnl.get(dzis) ?? 0;
    if (podstawa === "goal") {
      if (zasady.profitTargetCents !== null) zostaloDzisCents = Math.floor(prog * zasady.profitTargetCents) - dzisiaj;
    } else if (prog < 1) {
      // p <= prog * (reszta + p)  =>  p <= prog / (1 - prog) * reszta
      const reszta = zysk - dzisiaj;
      zostaloDzisCents = Math.floor((prog / (1 - prog)) * Math.max(0, reszta)) - dzisiaj;
    }
  }

  return { pct, podstawa, skutek, pewne, najlepszyDzienCents: najlepszy, mianownikCents: mianownik, udzial, naruszona, naGranicy, wymaganyCelCents, zostaloDzisCents };
}

/* ---------------------------------------------------------------------------
   Stan konta
   --------------------------------------------------------------------------- */

export const POZIOMY_OSTRZEZEN = [0.5, 0.75, 0.9] as const;

export type PoziomOstrzezenia = 50 | 75 | 90 | 100;

export type Ostrzezenie = {
  kod: "dd" | "dll" | "po_sl_dd" | "po_sl_dll" | "consistency" | "kontrakty";
  poziom: PoziomOstrzezenia;
  tekst: string;
};

/** Najwyzszy przekroczony prog zuzycia limitu, albo `null`. 100 = limit przekroczony. */
export function poziomZuzycia(zuzycie: number): PoziomOstrzezenia | null {
  if (zuzycie >= 1) return 100;
  for (let i = POZIOMY_OSTRZEZEN.length - 1; i >= 0; i -= 1) {
    if (zuzycie >= POZIOMY_OSTRZEZEN[i]) return Math.round(POZIOMY_OSTRZEZEN[i] * 100) as PoziomOstrzezenia;
  }
  return null;
}

export type BuforPoSl = {
  ryzykoCents: number;
  buforDdPoSlCents: number;
  buforDllPoSlCents: number | null;
  buforPoSlCents: number;
  /** Zuzycie limitu DD / DLL po trafieniu SL (0..1+). */
  zuzycieDdPoSl: number;
  zuzycieDllPoSl: number | null;
  /** Ile razy ryzyko planu miesci sie w buforze (bufor w R), dla najblizszego limitu. */
  buforWR: number;
  buforDdWR: number;
  buforDllWR: number | null;
  /** True, gdy trafienie SL przekroczyloby ktorys limit. */
  przekroczy: boolean;
};

export type StanKonta = {
  saldoStartCents: number;
  saldoCents: number;
  zyskCents: number;
  podstawaTrailingu: PodstawaTrailingu;
  podstawaPewna: boolean;
  szczytCents: number;
  /** Zysk, od ktorego prog DD stoi w miejscu (0 dla static, `null` = brak blokady). */
  zyskBlokadyCents: number | null;
  /** True, gdy prog osiagnal blokade (zysk szczytowy >= zysk blokady). */
  progZablokowany: boolean;
  progDdCents: number;
  buforDdCents: number;
  zuzycieDd: number;
  dzisPnlCents: number;
  buforDllCents: number | null;
  zuzycieDll: number | null;
  najblizszyLimit: "dd" | "dll" | null;
  buforCents: number;
  poSl: BuforPoSl | null;
  ostrzezenia: Ostrzezenie[];
  consistency: StanConsistency | null;
  cel: { zyskCents: number; celCents: number; brakCents: number; osiagniety: boolean } | null;
  dniHandlowe: number;
  minDni: { wymagane: number; mamy: number; spelnione: boolean } | null;
  uwagi: string[];
};

export type WejscieStanu = {
  zasady: ZasadyKonta;
  saldoStartCents: number;
  transakcje: readonly TransakcjaKonta[];
  /** Dzien handlowy "dzisiaj" (YYYY-MM-DD). EOD-trailing nie liczy biezacego dnia do szczytu. */
  dzis: string | null;
  /** Ryzyko planowanego trade'u z `computeTrade` w centach (> 0) albo `null`. */
  ryzykoPlanuCents?: number | null;
  /** Data (YYYY-MM-DD) ostatniej wypłaty z księgi - poczatek cyklu dla consistency `cycle`. */
  ostatniaWyplata?: string | null;
};

function sortuj(transakcje: readonly TransakcjaKonta[]): TransakcjaKonta[] {
  return transakcje
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (a.t.dzien !== b.t.dzien) return a.t.dzien < b.t.dzien ? -1 : 1;
      const ca = a.t.czas?.getTime() ?? 0;
      const cb = b.t.czas?.getTime() ?? 0;
      return ca !== cb ? ca - cb : a.i - b.i;
    })
    .map((x) => x.t);
}

function walidujZasady(z: ZasadyKonta): void {
  if (!TYPY_DD.includes(z.ddType)) throw new RangeError(`typ DD »${String(z.ddType)}« nieznany; dozwolone: ${TYPY_DD.join(", ")}`);
  if (!Number.isInteger(z.maxDdCents) || z.maxDdCents <= 0) throw new RangeError(`maxDdCents musi być dodatnią liczbą całkowitą (centy), jest ${z.maxDdCents}`);
  if (z.dailyLossCents !== null && (!Number.isInteger(z.dailyLossCents) || z.dailyLossCents <= 0)) {
    throw new RangeError(`dailyLossCents musi być dodatnią liczbą całkowitą (centy) albo null, jest ${z.dailyLossCents}`);
  }
  if (z.ddType === "trailing_to_static" && z.ddLockCents === null) {
    throw new RangeError("trailing_to_static wymaga ddLockCents (zysk, przy którym próg DD przestaje rosnąć)");
  }
}

export function stanKonta(w: WejscieStanu): StanKonta {
  const z = w.zasady;
  walidujZasady(z);
  if (!Number.isInteger(w.saldoStartCents)) throw new RangeError(`saldoStartCents musi być liczbą całkowitą (centy), jest ${w.saldoStartCents}`);
  const ryzyko = w.ryzykoPlanuCents ?? null;
  if (ryzyko !== null && (!Number.isInteger(ryzyko) || ryzyko <= 0)) {
    throw new RangeError(`ryzykoPlanuCents musi być dodatnią liczbą całkowitą (centy) z computeTrade, jest ${ryzyko}`);
  }
  const start = w.saldoStartCents;
  const trades = sortuj(w.transakcje);
  const uwagi: string[] = [];

  // Saldo po kazdym trade'ie i na koniec kazdego dnia.
  const eodPoDniach = new Map<string, number>();
  const dniPnl = new Map<string, number>();
  let saldo = start;
  let szczytIntraday = start;
  for (const t of trades) {
    saldo += t.pnlCents;
    if (saldo > szczytIntraday) szczytIntraday = saldo;
    eodPoDniach.set(t.dzien, saldo);
    dniPnl.set(t.dzien, (dniPnl.get(t.dzien) ?? 0) + t.pnlCents);
  }

  const { podstawa, pewna } = podstawaTrailingu(z.ddType, z.extra);
  if (!pewna) {
    uwagi.push(`Podstawa trailingu DD nie jest jednoznaczna w presecie (${tekstEx(z.extra, "trail_basis") ?? "brak"}): liczę ostrożniej, od szczytu intraday. Sprawdź w regulaminie.`);
  }

  let szczyt: number;
  if (podstawa === "eod") {
    szczyt = start;
    for (const [dzien, eod] of eodPoDniach) {
      // Biezacy dzien jeszcze sie nie zakonczyl: prog EOD rosnie dopiero po zamknieciu dnia.
      if (w.dzis !== null && dzien >= w.dzis) continue;
      if (eod > szczyt) szczyt = eod;
    }
  } else {
    szczyt = szczytIntraday;
    if (trades.length > 0) {
      uwagi.push("Szczyt intraday liczę ze zrealizowanych trade'ów; szczyt firmy uwzględnia też otwarte pozycje, więc rzeczywisty bufor może być mniejszy.");
    }
  }

  let zyskBlokady: number | null;
  if (z.ddType === "static") zyskBlokady = 0;
  else if (z.ddType === "trailing_to_static") zyskBlokady = z.ddLockCents;
  else zyskBlokady = null;
  if (zyskBlokady === null && tekstEx(z.extra, "lock_rule") !== null) {
    uwagi.push(`Preset opisuje blokadę progu DD (${tekstEx(z.extra, "lock_rule")}), której nie modeluję dla typu »${z.ddType}«: sprawdź w regulaminie albo ustaw typ »trailing_to_static« z zyskiem blokady.`);
  }

  const zyskSzczytowy = Math.max(0, szczyt - start);
  const zyskLiczony = zyskBlokady === null ? zyskSzczytowy : Math.min(zyskSzczytowy, zyskBlokady);
  const progDd = start + zyskLiczony - z.maxDdCents;
  const buforDd = saldo - progDd;
  const zuzycieDd = Math.max(0, 1 - buforDd / z.maxDdCents);

  const dzisPnl = w.dzis !== null ? (dniPnl.get(w.dzis) ?? 0) : 0;
  const dll = z.dailyLossCents;
  const buforDll = dll !== null ? dll + dzisPnl : null;
  const zuzycieDll = dll !== null ? Math.max(0, -dzisPnl) / dll : null;
  if (dll === null && typeof z.extra.dll_optional_usd === "number") {
    uwagi.push(`Dzienny limit straty jest opcjonalny w tym programie (${z.extra.dll_optional_usd} USD) i nie został wybrany w regułach konta: bufor dzienny nie jest liczony.`);
  }

  let najblizszy: "dd" | "dll" = "dd";
  let bufor = buforDd;
  if (buforDll !== null && buforDll < buforDd) {
    najblizszy = "dll";
    bufor = buforDll;
  }

  const ostrzezenia: Ostrzezenie[] = [];
  const pDd = poziomZuzycia(zuzycieDd);
  if (pDd !== null) {
    ostrzezenia.push({
      kod: "dd",
      poziom: pDd,
      tekst:
        pDd === 100
          ? `Limit drawdownu przekroczony: bufor ${kwotaUsd(buforDd)} (prog ${kwotaUsd(progDd)}, saldo ${kwotaUsd(saldo)}).`
          : `Drawdown: wykorzystano ${procent(zuzycieDd)} limitu ${kwotaUsd(z.maxDdCents)}. Do progu zostało ${kwotaUsd(buforDd)}.`,
    });
  }
  const pDll = zuzycieDll !== null ? poziomZuzycia(zuzycieDll) : null;
  if (pDll !== null && dll !== null && zuzycieDll !== null) {
    ostrzezenia.push({
      kod: "dll",
      poziom: pDll,
      tekst:
        pDll === 100
          ? `Dzienny limit straty przekroczony: dzisiejszy wynik ${kwotaUsd(dzisPnl)} przy limicie ${kwotaUsd(dll)}.`
          : `Dzienny limit straty: wykorzystano ${procent(zuzycieDll)} (${kwotaUsd(-dzisPnl)} z ${kwotaUsd(dll)}). Zostało ${kwotaUsd(buforDll!)}.`,
    });
  }

  let poSl: BuforPoSl | null = null;
  if (ryzyko !== null) {
    const buforDdPoSl = buforDd - ryzyko;
    const buforDllPoSl = buforDll !== null ? buforDll - ryzyko : null;
    const zuzycieDdPoSl = Math.max(0, 1 - buforDdPoSl / z.maxDdCents);
    const zuzycieDllPoSl = dll !== null && buforDllPoSl !== null ? Math.max(0, 1 - buforDllPoSl / dll) : null;
    const buforPoSl = Math.min(buforDdPoSl, buforDllPoSl ?? Number.POSITIVE_INFINITY);
    poSl = {
      ryzykoCents: ryzyko,
      buforDdPoSlCents: buforDdPoSl,
      buforDllPoSlCents: buforDllPoSl,
      buforPoSlCents: buforPoSl,
      zuzycieDdPoSl,
      zuzycieDllPoSl,
      buforWR: bufor / ryzyko,
      buforDdWR: buforDd / ryzyko,
      buforDllWR: buforDll !== null ? buforDll / ryzyko : null,
      przekroczy: buforPoSl < 0,
    };
    const pSlDd = poziomZuzycia(zuzycieDdPoSl);
    if (pSlDd !== null && (pDd === null || pSlDd > pDd)) {
      ostrzezenia.push({
        kod: "po_sl_dd",
        poziom: pSlDd,
        tekst:
          pSlDd === 100
            ? `Jeśli trafi SL (${kwotaUsd(ryzyko)}), przekroczysz limit drawdownu: bufor ${kwotaUsd(buforDd)} jest mniejszy od ryzyka.`
            : `Jeśli trafi SL (${kwotaUsd(ryzyko)}), wykorzystasz ${procent(zuzycieDdPoSl)} limitu drawdownu; zostanie ${kwotaUsd(buforDdPoSl)}.`,
      });
    }
    const dllPoSl = poSl.zuzycieDllPoSl;
    const pSlDll = dllPoSl !== null ? poziomZuzycia(dllPoSl) : null;
    if (pSlDll !== null && dll !== null && dllPoSl !== null && (pDll === null || pSlDll > pDll)) {
      ostrzezenia.push({
        kod: "po_sl_dll",
        poziom: pSlDll,
        tekst:
          pSlDll === 100
            ? `Jeśli trafi SL (${kwotaUsd(ryzyko)}), przekroczysz dzienny limit straty ${kwotaUsd(dll)} (dziś ${kwotaUsd(dzisPnl)}).`
            : `Jeśli trafi SL (${kwotaUsd(ryzyko)}), wykorzystasz ${procent(dllPoSl)} dziennego limitu straty.`,
      });
    }
  }

  // Consistency liczona na oknie wynikajacym z podstawy.
  let consistency: StanConsistency | null = null;
  if (z.consistencyPct !== null) {
    const { podstawa: pc } = znaczenieConsistency(z.extra);
    const okno = new Map<string, number>();
    for (const [dzien, pnl] of dniPnl) {
      if (pc === "cycle" && w.ostatniaWyplata && dzien <= w.ostatniaWyplata) continue;
      okno.set(dzien, pnl);
    }
    consistency = liczConsistency(z, okno, w.dzis);
    if (consistency) {
      if (!consistency.pewne) {
        uwagi.push(
          `Znaczenie consistency nie jest jednoznaczne w presecie (podstawa: ${PODSTAWA_CONSISTENCY_NAZWY[consistency.podstawa]}, skutek: ${SKUTEK_CONSISTENCY_NAZWY[consistency.skutek]}): potwierdź w regulaminie.`,
        );
      }
      if (consistency.naruszona || consistency.naGranicy) {
        const udz = consistency.udzial ?? 0;
        ostrzezenia.push({
          kod: "consistency",
          poziom: consistency.naruszona ? 100 : 90,
          tekst: consistency.naruszona
            ? `Consistency ${consistency.pct}% złamana: najlepszy dzień ${kwotaUsd(consistency.najlepszyDzienCents)} to ${procent(udz)} (${PODSTAWA_CONSISTENCY_NAZWY[consistency.podstawa]}). Skutek: ${SKUTEK_CONSISTENCY_NAZWY[consistency.skutek]}.`
            : `Consistency ${consistency.pct}% blisko granicy: najlepszy dzień to ${procent(udz)} (${PODSTAWA_CONSISTENCY_NAZWY[consistency.podstawa]}).`,
        });
      }
    }
  }

  const zysk = saldo - start;
  const cel =
    z.profitTargetCents !== null
      ? { zyskCents: zysk, celCents: z.profitTargetCents, brakCents: Math.max(0, z.profitTargetCents - zysk), osiagniety: zysk >= z.profitTargetCents }
      : null;
  const dniHandlowe = dniPnl.size;
  const minDni = z.minDays !== null ? { wymagane: z.minDays, mamy: dniHandlowe, spelnione: dniHandlowe >= z.minDays } : null;

  return {
    saldoStartCents: start,
    saldoCents: saldo,
    zyskCents: zysk,
    podstawaTrailingu: podstawa,
    podstawaPewna: pewna,
    szczytCents: szczyt,
    zyskBlokadyCents: zyskBlokady,
    progZablokowany: zyskBlokady !== null && zyskSzczytowy >= zyskBlokady,
    progDdCents: progDd,
    buforDdCents: buforDd,
    zuzycieDd,
    dzisPnlCents: dzisPnl,
    buforDllCents: buforDll,
    zuzycieDll,
    najblizszyLimit: najblizszy,
    buforCents: bufor,
    poSl,
    ostrzezenia,
    consistency,
    cel,
    dniHandlowe,
    minDni,
    uwagi,
  };
}

/* ---------------------------------------------------------------------------
   Laczna ekspozycja NQ na kontach
   --------------------------------------------------------------------------- */

/** Ile kontraktow NQ (mini) to jeden kontrakt danego symbolu; `null` = to nie NQ. */
export function ekwiwalentNqNaKontrakt(symbol: string): number | null {
  const s = symbol.trim().toUpperCase();
  // NQ, MNQ, NQ1!, MNQ1!, NQZ6, MNQH2026 ...
  const m = /^(M?NQ)(?:[FGHJKMNQUVXZ]\d{1,4}|\d?!)?$/.exec(s);
  if (!m) return null;
  return m[1] === "MNQ" ? 0.1 : 1;
}

export type PozycjaDoEkspozycji = { accountId: number; symbol: string; contracts: number };

export type EkspozycjaNq = {
  /** Laczna ekspozycja w ekwiwalencie kontraktow NQ (mini). */
  lacznie: number;
  perKonto: { accountId: number; ekwiwalentNq: number; kontraktyNq: number; kontraktyMnq: number }[];
  /** Symbole, ktore nie sa NQ i zostaly pominiete. */
  pominiete: string[];
};

/**
 * Jedna decyzja "kupuje NQ" na pieciu kontach to piec razy wieksza ekspozycja
 * (i ten sam kierunek ryzyka). Micro liczone jako 0,1 kontraktu mini.
 */
export function lacznaEkspozycjaNq(pozycje: readonly PozycjaDoEkspozycji[]): EkspozycjaNq {
  const mapa = new Map<number, { ekwiwalentNq: number; kontraktyNq: number; kontraktyMnq: number }>();
  const pominiete = new Set<string>();
  for (const p of pozycje) {
    const e = ekwiwalentNqNaKontrakt(p.symbol);
    if (e === null) {
      pominiete.add(p.symbol);
      continue;
    }
    const w = mapa.get(p.accountId) ?? { ekwiwalentNq: 0, kontraktyNq: 0, kontraktyMnq: 0 };
    w.ekwiwalentNq += e * p.contracts;
    if (e === 1) w.kontraktyNq += p.contracts;
    else w.kontraktyMnq += p.contracts;
    mapa.set(p.accountId, w);
  }
  const perKonto = [...mapa.entries()]
    .map(([accountId, w]) => ({ accountId, ekwiwalentNq: Math.round(w.ekwiwalentNq * 1e6) / 1e6, kontraktyNq: w.kontraktyNq, kontraktyMnq: w.kontraktyMnq }))
    .sort((a, b) => a.accountId - b.accountId);
  const lacznie = Math.round(perKonto.reduce((s, k) => s + k.ekwiwalentNq, 0) * 1e6) / 1e6;
  return { lacznie, perKonto, pominiete: [...pominiete].sort() };
}

/** Ostrzezenie, gdy kontrakty na koncie przekraczaja limit reguł konta (mini albo micro). */
export function ostrzezenieKontraktow(
  zasady: Pick<ZasadyKonta, "maxContractsMini" | "maxContractsMicro">,
  kontraktyNq: number,
  kontraktyMnq: number,
): Ostrzezenie | null {
  if (zasady.maxContractsMini !== null && kontraktyNq > zasady.maxContractsMini) {
    return { kod: "kontrakty", poziom: 100, tekst: `Limit kontraktów mini przekroczony: ${kontraktyNq} przy limicie ${zasady.maxContractsMini}.` };
  }
  if (zasady.maxContractsMicro !== null && kontraktyMnq > zasady.maxContractsMicro) {
    return { kod: "kontrakty", poziom: 100, tekst: `Limit kontraktów micro przekroczony: ${kontraktyMnq} przy limicie ${zasady.maxContractsMicro}.` };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Niepotwierdzone reguly konta
   --------------------------------------------------------------------------- */

/**
 * Sila typu DD: im wyzszy numer, tym ostrzejszy. `intraday` podnosi prog po kazdym zamknietym trade'cie,
 * `eod` po kazdym zakonczonym dniu, `trailing_to_static` tak samo, ale tylko do blokady, a `static`
 * nie podnosi progu nigdy.
 */
const SILA_TYPU_DD: Record<TypDd, number> = { static: 0, trailing_to_static: 1, eod: 2, intraday: 3 };

export type ZasadyOstrzejsze = { zasady: ZasadyKonta; zrodloTypuDd: "potwierdzone" | "nowe" };

const minNonNull = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));
const maxNonNull = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * Dopoki nowa regula konta nie jest potwierdzona w aplikacji (Slowa uzytkownika 15.10.2026: «Licz na
 * ostrzejszej»), bufory i ostrzezenia liczy sie na OSTRZEJSZEJ z dwoch: ostatniej potwierdzonej i nowej,
 * pole po polu. Ostrzejsze znaczy: mniejszy limit DD, mniejszy dzienny limit straty, mniejszy cel i
 * prog consistency (to ostrzejsza kontrola), mniej kontraktow, wiecej minimalnych dni, wyzsza blokada
 * (prog DD rosnie dluzej) i silniejszy typ DD. `extra` idzie razem z typem DD, bo opisuje jego podstawe.
 * Brak wartosci (`null`) po jednej stronie nie oslabia drugiej.
 */
export function ostrzejszeZasady(potwierdzone: ZasadyKonta, nowe: ZasadyKonta): ZasadyOstrzejsze {
  const typZNowych = SILA_TYPU_DD[nowe.ddType] > SILA_TYPU_DD[potwierdzone.ddType];
  const baza = typZNowych ? nowe : potwierdzone;
  return {
    zrodloTypuDd: typZNowych ? "nowe" : "potwierdzone",
    zasady: {
      ddType: baza.ddType,
      maxDdCents: Math.min(potwierdzone.maxDdCents, nowe.maxDdCents),
      ddLockCents: baza.ddType === "trailing_to_static" ? maxNonNull(potwierdzone.ddLockCents, nowe.ddLockCents) : (baza.ddLockCents ?? maxNonNull(potwierdzone.ddLockCents, nowe.ddLockCents)),
      dailyLossCents: minNonNull(potwierdzone.dailyLossCents, nowe.dailyLossCents),
      profitTargetCents: minNonNull(potwierdzone.profitTargetCents, nowe.profitTargetCents),
      consistencyPct: minNonNull(potwierdzone.consistencyPct, nowe.consistencyPct),
      minDays: maxNonNull(potwierdzone.minDays, nowe.minDays),
      maxContractsMini: minNonNull(potwierdzone.maxContractsMini, nowe.maxContractsMini),
      maxContractsMicro: minNonNull(potwierdzone.maxContractsMicro, nowe.maxContractsMicro),
      extra: baza.extra,
    },
  };
}
