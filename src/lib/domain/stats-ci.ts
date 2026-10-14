/**
 * Statystyka uczciwa (ADR-033, MUST 5; metodyka R11-R14).
 *
 * Ten dziennik ma bronic przed wnioskami z malej proby, a nie je produkowac.
 * Kazda liczba wychodzi z `n` i z przedzialem:
 *  - win rate: przedzial Wilsona 95%,
 *  - expectancy (srednie R): bootstrap percentylowy z ZIARNEM (ten sam zbior
 *    daje ten sam przedzial) i flaga "orientacyjnie" przy n < 30,
 *  - test wzgledem break-even win rate, liczonego z WLASNYCH srednich W i L
 *    w R, nie wzgledem 50%,
 *  - status setupu / hipotezy wedlug progow zadeklarowanych z gory.
 *
 * Modul czysty: bez bazy, bez Next, bez Date.now() i bez Math.random().
 * Przypadki testowe pochodza z raportu `docs/research/metodyka.md`:
 * 15/30 -> 33,2-66,8%; 8/10 -> 49,0-94,3%; 50/100 -> 40,4-59,6%.
 */

/** Kwantyl rozkladu normalnego dla dwustronnego przedzialu 95%. */
export const Z_95 = 1.959963984540054;

/** Ponizej tej liczby trade'ow przedzial bootstrapu jest tylko orientacyjny (metodyka R11). */
export const PROG_ORIENTACYJNIE_N = 30;

/** Domyslne ziarno bootstrapu: ten sam zbior R daje zawsze ten sam przedzial. */
export const DOMYSLNE_ZIARNO = 20261014;

export const DOMYSLNE_ITERACJE = 5000;

/* ---------------------------------------------------------------------------
   Wilson
   --------------------------------------------------------------------------- */

export type PrzedzialWilsona = {
  n: number;
  wins: number;
  /** Obserwowany odsetek wygranych, 0..1. `null` przy n = 0. */
  p: number | null;
  low: number | null;
  high: number | null;
};

/**
 * Przedzial ufnosci Wilsona dla odsetka sukcesow. Dla n = 0 wszystko `null`:
 * brak danych nie jest przedzialem 0-100%, tylko brakiem odpowiedzi.
 */
export function wilson(wins: number, n: number, z: number = Z_95): PrzedzialWilsona {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`wilson: n musi być liczbą całkowitą >= 0, jest ${n}`);
  if (!Number.isInteger(wins) || wins < 0 || wins > n) {
    throw new RangeError(`wilson: wygranych musi być od 0 do n (${n}), jest ${wins}`);
  }
  if (n === 0) return { n, wins, p: null, low: null, high: null };
  const p = wins / n;
  const z2 = z * z;
  const mianownik = 1 + z2 / n;
  const srodek = (p + z2 / (2 * n)) / mianownik;
  const polowa = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / mianownik;
  return { n, wins, p, low: Math.max(0, srodek - polowa), high: Math.min(1, srodek + polowa) };
}

/* ---------------------------------------------------------------------------
   Generator liczb pseudolosowych z ziarnem (mulberry32)
   --------------------------------------------------------------------------- */

export function generatorZZiarnem(ziarno: number): () => number {
  let a = ziarno >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
   Bootstrap expectancy
   --------------------------------------------------------------------------- */

export type PrzedzialExpectancy = {
  n: number;
  /** Srednie R. `null` przy n = 0. */
  mean: number | null;
  low: number | null;
  high: number | null;
  /** n < 30: przedzial pokazujemy, ale z flaga "orientacyjnie" (R11). */
  orientacyjnie: boolean;
  /** Pelny przedzial wymaga co najmniej dwoch pomiarow; przy n = 1 low = high = mean i to jest zaznaczone. */
  zdegenerowany: boolean;
  ziarno: number;
  iteracje: number;
};

export type OpcjeBootstrapu = {
  ziarno?: number;
  iteracje?: number;
  /** Poziom ufnosci, domyslnie 0,95. */
  poziom?: number;
};

function kwantyl(posortowane: number[], q: number): number {
  const poz = q * (posortowane.length - 1);
  const dol = Math.floor(poz);
  const gora = Math.ceil(poz);
  if (dol === gora) return posortowane[dol];
  return posortowane[dol] + (posortowane[gora] - posortowane[dol]) * (poz - dol);
}

/**
 * Bootstrap percentylowy sredniego R. UWAGA (metodyka 1.2): przy skosnym
 * rozkladzie R i n < 30 przedzial jest zbyt optymistyczny, dlatego `orientacyjnie`.
 */
export function bootstrapExpectancy(rValues: readonly number[], opcje: OpcjeBootstrapu = {}): PrzedzialExpectancy {
  const ziarno = opcje.ziarno ?? DOMYSLNE_ZIARNO;
  const iteracje = opcje.iteracje ?? DOMYSLNE_ITERACJE;
  const poziom = opcje.poziom ?? 0.95;
  if (!Number.isInteger(iteracje) || iteracje < 100) {
    throw new RangeError(`bootstrapExpectancy: iteracji musi być co najmniej 100, jest ${iteracje}`);
  }
  if (!(poziom > 0 && poziom < 1)) throw new RangeError(`bootstrapExpectancy: poziom musi leżeć w (0, 1), jest ${poziom}`);
  const wartosci = rValues.filter((r) => Number.isFinite(r));
  const n = wartosci.length;
  const baza = { n, orientacyjnie: n < PROG_ORIENTACYJNIE_N, ziarno, iteracje };
  if (n === 0) return { ...baza, mean: null, low: null, high: null, zdegenerowany: true };
  const mean = wartosci.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { ...baza, mean, low: mean, high: mean, zdegenerowany: true };

  const los = generatorZZiarnem(ziarno);
  const srednie = new Array<number>(iteracje);
  for (let i = 0; i < iteracje; i += 1) {
    let suma = 0;
    for (let j = 0; j < n; j += 1) suma += wartosci[Math.floor(los() * n)];
    srednie[i] = suma / n;
  }
  srednie.sort((a, b) => a - b);
  const alfa = (1 - poziom) / 2;
  return { ...baza, mean, low: kwantyl(srednie, alfa), high: kwantyl(srednie, 1 - alfa), zdegenerowany: false };
}

/* ---------------------------------------------------------------------------
   Break-even win rate
   --------------------------------------------------------------------------- */

/**
 * Pomiar w R z klasyfikacja wyniku. Zwykla liczba to R, a klasa wynika ze znaku
 * (>0 zysk, <0 strata, 0 BE). Obiekt pozwala podac klase z zewnatrz: trade z +0,05R
 * jest »BE« wg progu z ADR-011, wiec nie wchodzi ani do wygranych, ani do strat,
 * choc jego R liczy sie do expectancy.
 */
export type Pomiar = number | { r: number; wynik: "zysk" | "strata" | "be" };

type PomiarZKlasa = { r: number; klasa: 1 | 0 | -1 };

function normalizujPomiary(pomiary: readonly Pomiar[]): PomiarZKlasa[] {
  const wynik: PomiarZKlasa[] = [];
  for (const p of pomiary) {
    const r = typeof p === "number" ? p : p.r;
    if (!Number.isFinite(r)) continue;
    const klasa = typeof p === "number" ? (r > 0 ? 1 : r < 0 ? -1 : 0) : p.wynik === "zysk" ? 1 : p.wynik === "strata" ? -1 : 0;
    wynik.push({ r, klasa });
  }
  return wynik;
}

export type BreakEven = {
  wins: number;
  losses: number;
  /** Srednia wygrana w R (dodatnia). */
  avgWinR: number | null;
  /** Srednia strata w R, WARTOSC BEZWZGLEDNA (dodatnia). */
  avgLossR: number | null;
  /** L / (W + L). `null`, gdy brakuje wygranych albo strat: wtedy nie ma z czego policzyc. */
  winRate: number | null;
};

/**
 * Break-even win rate z WLASNYCH srednich: L / (W + L), gdzie W i L to srednie
 * wygrana i strata w R. Trade'y z R = 0 (czyste BE) nie wchodza ani do W, ani do L.
 * Win rate wyzszy od tego progu = dodatnie oczekiwane R.
 */
export function breakEvenWinRate(pomiary: readonly Pomiar[]): BreakEven {
  const wszystkie = normalizujPomiary(pomiary);
  const wygrane = wszystkie.filter((p) => p.klasa === 1).map((p) => p.r);
  const straty = wszystkie.filter((p) => p.klasa === -1).map((p) => p.r);
  const avgWinR = wygrane.length > 0 ? wygrane.reduce((s, x) => s + Math.abs(x), 0) / wygrane.length : null;
  const avgLossR = straty.length > 0 ? straty.reduce((s, x) => s + Math.abs(x), 0) / straty.length : null;
  const winRate = avgWinR !== null && avgLossR !== null ? avgLossR / (avgWinR + avgLossR) : null;
  return { wins: wygrane.length, losses: straty.length, avgWinR, avgLossR, winRate };
}

/* ---------------------------------------------------------------------------
   Status setupu i hipotezy (progi zadeklarowane Z GORY)
   --------------------------------------------------------------------------- */

export const STATUSY_STATYSTYCZNE = ["niewazny", "niejednoznaczny", "obiecujacy", "potwierdzony"] as const;
export type StatusStatystyczny = (typeof STATUSY_STATYSTYCZNE)[number];

export const STATUS_NAZWY: Record<StatusStatystyczny, string> = {
  niewazny: "nieważny",
  niejednoznaczny: "niejednoznaczny",
  obiecujacy: "obiecujący",
  potwierdzony: "potwierdzony",
};

/**
 * Progi statusu. Zyja w `setup_versions.thresholds` albo `hypotheses.thresholds`
 * i sa zapisywane PRZED zebraniem proby (zmiana progu hipotezy po fakcie jest
 * logowana triggerem, zmiana progu setupu to nowa wersja).
 *  - `minN`: ponizej tej liczby trade'ow wynik jest nieważny (za malo danych);
 *  - `potwierdzenieN`: od tej liczby dolna granica Wilsona nad break-even daje "potwierdzony".
 */
export type ProgiStatusu = { minN: number; potwierdzenieN: number };

export const DOMYSLNE_PROGI_STATUSU: ProgiStatusu = { minN: 20, potwierdzenieN: 100 };

export type WynikWalidacjiProgow = { ok: true; progi: ProgiStatusu } | { ok: false; error: string };

/** Progi z surowego JSON-a (kolumna `thresholds`); brak pola = wartosc domyslna, smiec = blad. */
export function progiStatusuZJson(surowe: unknown): WynikWalidacjiProgow {
  if (surowe === null || surowe === undefined) return { ok: true, progi: { ...DOMYSLNE_PROGI_STATUSU } };
  if (typeof surowe !== "object" || Array.isArray(surowe)) {
    return { ok: false, error: "progi statusu muszą być obiektem {minN, potwierdzenieN}" };
  }
  const o = surowe as Record<string, unknown>;
  const minN = o.minN === undefined ? DOMYSLNE_PROGI_STATUSU.minN : o.minN;
  const potwierdzenieN = o.potwierdzenieN === undefined ? DOMYSLNE_PROGI_STATUSU.potwierdzenieN : o.potwierdzenieN;
  if (typeof minN !== "number" || !Number.isInteger(minN) || minN < 1) {
    return { ok: false, error: `minN: oczekiwano liczby całkowitej >= 1, jest ${JSON.stringify(minN)}` };
  }
  if (typeof potwierdzenieN !== "number" || !Number.isInteger(potwierdzenieN) || potwierdzenieN < minN) {
    return { ok: false, error: `potwierdzenieN: oczekiwano liczby całkowitej >= minN (${minN}), jest ${JSON.stringify(potwierdzenieN)}` };
  }
  return { ok: true, progi: { minN, potwierdzenieN } };
}

export type PowodStatusu = "za_malo_danych" | "dane_przeciw" | "przedzial_obejmuje_break_even" | "nad_break_even_w_probie" | "nad_break_even_potwierdzone";

export type OcenaStatusu = {
  status: StatusStatystyczny;
  powod: PowodStatusu;
  n: number;
  wins: number;
  losses: number;
  wilson: PrzedzialWilsona;
  breakEven: BreakEven;
  expectancy: PrzedzialExpectancy;
  progi: ProgiStatusu;
  /** Jedno zdanie po polsku: dlaczego taki status, z liczbami. */
  opis: string;
};

const proc = (x: number | null) => (x === null ? "brak" : `${(x * 100).toFixed(1).replace(".", ",")}%`);

/**
 * Status z wynikow w R.
 *  - nieważny: n < minN (za malo danych) ALBO caly przedzial Wilsona lezy
 *    PONIZEJ break-even (dane mowia "nie dziala" - hipoteza traci wazność);
 *  - niejednoznaczny: n >= minN, przedzial obejmuje break-even, a obserwowany win rate go nie przekracza;
 *  - obiecujacy: n >= minN, obserwowany win rate nad break-even, ale dolna granica
 *    przedzialu jeszcze nie (albo n < potwierdzenieN);
 *  - potwierdzony: n >= potwierdzenieN i dolna granica Wilsona nad break-even.
 * Trade'y z R = 0 liczy sie do n, nie do wygranych ani strat.
 */
export function statusZWynikow(pomiary: readonly Pomiar[], progi: ProgiStatusu = DOMYSLNE_PROGI_STATUSU, opcje: OpcjeBootstrapu = {}): OcenaStatusu {
  const znormalizowane = normalizujPomiary(pomiary);
  const wartosci = znormalizowane.map((p) => p.r);
  const n = wartosci.length;
  const be = breakEvenWinRate(znormalizowane.map((p) => ({ r: p.r, wynik: p.klasa === 1 ? "zysk" : p.klasa === -1 ? "strata" : "be" }) as const));
  // Win rate liczymy od rozstrzygnietych (zysk + strata); R = 0 nie jest wygrana ani strata.
  const rozstrzygniete = be.wins + be.losses;
  const w = wilson(be.wins, rozstrzygniete);
  const expectancy = bootstrapExpectancy(wartosci, opcje);
  const baza = { n, wins: be.wins, losses: be.losses, wilson: w, breakEven: be, expectancy, progi };

  if (n < progi.minN) {
    return {
      ...baza,
      status: "niewazny",
      powod: "za_malo_danych",
      opis: `Nieważny: ${n} z wymaganych ${progi.minN} trade'ów. Poniżej progu nie oceniamy, czy to działa.`,
    };
  }
  if (be.winRate === null || w.low === null || w.high === null || w.p === null) {
    return {
      ...baza,
      status: "niejednoznaczny",
      powod: "przedzial_obejmuje_break_even",
      opis: `Niejednoznaczny: ${n} trade'ów, ale brakuje wygranych albo strat, więc nie da się policzyć break-even win rate z własnych średnich.`,
    };
  }
  if (w.high < be.winRate) {
    return {
      ...baza,
      status: "niewazny",
      powod: "dane_przeciw",
      opis: `Nieważny: cały przedział Wilsona (${proc(w.low)}-${proc(w.high)}) leży poniżej break-even ${proc(be.winRate)}. Dane przemawiają przeciw.`,
    };
  }
  if (w.low > be.winRate && n >= progi.potwierdzenieN) {
    return {
      ...baza,
      status: "potwierdzony",
      powod: "nad_break_even_potwierdzone",
      opis: `Potwierdzony: dolna granica Wilsona ${proc(w.low)} jest nad break-even ${proc(be.winRate)} przy n = ${n} (próg ${progi.potwierdzenieN}).`,
    };
  }
  if (w.p > be.winRate) {
    return {
      ...baza,
      status: "obiecujacy",
      powod: "nad_break_even_w_probie",
      opis:
        w.low > be.winRate
          ? `Obiecujący w próbie: dolna granica ${proc(w.low)} nad break-even ${proc(be.winRate)}, ale n = ${n} < ${progi.potwierdzenieN} wymaganych do potwierdzenia.`
          : `Obiecujący w próbie: win rate ${proc(w.p)} nad break-even ${proc(be.winRate)}, ale przedział ${proc(w.low)}-${proc(w.high)} jeszcze go obejmuje.`,
    };
  }
  return {
    ...baza,
    status: "niejednoznaczny",
    powod: "przedzial_obejmuje_break_even",
    opis: `Niejednoznaczny: win rate ${proc(w.p)} nie przekracza break-even ${proc(be.winRate)}, a przedział ${proc(w.low)}-${proc(w.high)} go obejmuje.`,
  };
}

/* ---------------------------------------------------------------------------
   Hipoteza: zbieranie -> do oceny
   --------------------------------------------------------------------------- */

export type FazaHipotezy = "zbieranie" | "do_oceny";

/** n < prog_n: zbieranie. Ponizej progu AI nie moze zaproponowac reguly (bramka w bazie, TJ422). */
export function fazaHipotezy(n: number, progN: number): FazaHipotezy {
  return n >= progN ? "do_oceny" : "zbieranie";
}

/* ---------------------------------------------------------------------------
   Licznik wariantow (testowanie wielokrotne, metodyka R14)
   --------------------------------------------------------------------------- */

/** Odwrotna dystrybuanta rozkladu normalnego (algorytm Acklama, blad wzgledny < 1,2e-9). */
export function odwrotnaNormalna(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`odwrotnaNormalna: p musi leżeć w (0, 1), jest ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Oczekiwane zawyzenie NAJLEPSZEGO z k wariantow przy czystym szumie, w
 * odchyleniach standardowych (przyblizenie Blom: E[max] = Phi^-1((k - 0,375) / (k + 0,25))).
 * k = 1 -> 0. To licznik prob, nie pelne DSR: wystarczy, zeby uczciwie powiedziec
 * "testowano k wariantow, wynik najlepszego jest zawyzony".
 */
export function zawyzenieNajlepszego(k: number): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`zawyzenieNajlepszego: k musi być liczbą całkowitą >= 1, jest ${k}`);
  if (k === 1) return 0;
  return odwrotnaNormalna((k - 0.375) / (k + 0.25));
}

export type OstrzezenieWariantow = {
  k: number;
  n: number | null;
  /** True od dwoch wariantow: wynik najlepszego jest zawyzony. */
  zawyzony: boolean;
  zawyzenieSigma: number;
  tekst: string;
};

export function ostrzezenieWariantow(k: number, n: number | null): OstrzezenieWariantow {
  const zawyzenieSigma = zawyzenieNajlepszego(k);
  const zawyzony = k >= 2;
  const naN = n === null ? "" : ` na ${n} trade'ach`;
  const tekst = zawyzony
    ? `Testowano ${k} wariantów${naN}. Wynik najlepszego jest zawyżony: przy czystym szumie najlepszy z ${k} wypadałby średnio ${zawyzenieSigma.toFixed(2).replace(".", ",")} odchylenia standardowego nad przeciętną.`
    : `Testowano 1 wariant${naN}. Zawyżenia z wielokrotnego testowania nie ma.`;
  return { k, n, zawyzony, zawyzenieSigma, tekst };
}
