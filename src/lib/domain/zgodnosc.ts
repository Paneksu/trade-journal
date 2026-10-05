/**
 * Zgodnosc z regulami na podstawie ocen AI (`trade_rule_checks`, ADR-028).
 * Modul czysty: dostaje wiersze, zwraca liczby.
 *
 * Zasada, ktora go trzyma w ryzach: w mianowniku sa WYLACZNIE reguly realnie
 * ocenione, czyli `pass` i `fail`. Reguly `na` (nie dotyczy) i `unclear`
 * (AI nie umialo rozstrzygnac) nie sa ani zgodnoscia, ani lamaniem - liczone
 * jako zgodne zawyzylyby wynik, liczone jako niezgodne zanizylyby go. Jedyne
 * uczciwe miejsce dla nich to osobny licznik "nieocenione", pokazywany obok
 * procentu, tak jak przy trafnosci kierunku (ADR-018): sam procent bez liczby
 * nieocenionych jest liczba prawdziwa i myslaca zarazem.
 */

export type Werdykt = "pass" | "fail" | "na" | "unclear";
export type WerdyktUzytkownika = "agree" | "disagree";

export type SprawdzenieRegulyDoStatystyk = {
  tradeId: number;
  ruleId: string;
  ruleText: string;
  verdict: Werdykt;
  userVerdict: WerdyktUzytkownika | null;
  /** R trade'a; `null` gdy trade nie ma stopa albo wyniku. */
  rMultiple: number | null;
};

export type LiczniZgodnosci = {
  /** Mianownik: pass + fail. */
  ocenione: number;
  zgodne: number;
  niezgodne: number;
  /** na + unclear - poza mianownikiem, ale jawnie policzone. */
  nieocenione: number;
  /** zgodne / ocenione w procentach; `null`, gdy nie ma czego dzielic. */
  zgodnoscPct: number | null;
};

export type StatyReguly = LiczniZgodnosci & {
  ruleId: string;
  /** Tresc reguly z NAJNOWSZEJ ocen (wiersze podajemy od najnowszej). */
  ruleText: string;
  /** Srednie R trade'ow, w ktorych regula zostala dotrzymana / zlamana. `null` bez prob z R. */
  sredniaRPrzyDotrzymaniu: number | null;
  sredniaRPrzyZlamaniu: number | null;
  probaRPrzyDotrzymaniu: number;
  probaRPrzyZlamaniu: number;
};

export type StatyTradow = {
  /** Trady z co najmniej jedna regula ocenionej (pass albo fail). */
  ocenione: number;
  /** Trady ocenione, w ktorych nie ma zadnego `fail`. */
  zgodne: number;
  niezgodne: number;
  /** Trady bez zadnej ocenionej reguly: bez oceny AI albo z samymi na/unclear. */
  nieocenione: number;
  zgodnoscPct: number | null;
};

export type StatyZgodnosci = {
  /** Wszystkie sprawdzenia regul, bez wzgledu na trade. */
  reguly: LiczniZgodnosci;
  trady: StatyTradow;
  poRegule: StatyReguly[];
  /** Jak czesto uzytkownik zgadza sie z ocena AI - tylko tam, gdzie sie wypowiedzial. */
  zgodaUzytkownika: { wypowiedzi: number; zgadzaSie: number; niezgadzaSie: number; zgodaPct: number | null };
};

function procent(licznik: number, mianownik: number): number | null {
  return mianownik === 0 ? null : Math.round((licznik / mianownik) * 1000) / 10;
}

function srednia(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10_000) / 10_000;
}

function liczniki(sprawdzenia: SprawdzenieRegulyDoStatystyk[]): LiczniZgodnosci {
  let zgodne = 0;
  let niezgodne = 0;
  let nieocenione = 0;
  for (const s of sprawdzenia) {
    if (s.verdict === "pass") zgodne += 1;
    else if (s.verdict === "fail") niezgodne += 1;
    else nieocenione += 1;
  }
  const ocenione = zgodne + niezgodne;
  return { ocenione, zgodne, niezgodne, nieocenione, zgodnoscPct: procent(zgodne, ocenione) };
}

/**
 * @param sprawdzenia  wiersze od NAJNOWSZEJ oceny (dla `ruleText` w zestawieniu)
 * @param liczbaTradowBezOceny  trady z zakresu, ktore w ogole nie maja oceny AI;
 *   dochodza do `trady.nieocenione`, bo z samych wierszy regul nie da sie ich zobaczyc
 */
export function statyZgodnosci(
  sprawdzenia: SprawdzenieRegulyDoStatystyk[],
  liczbaTradowBezOceny = 0,
): StatyZgodnosci {
  const poTradzie = new Map<number, SprawdzenieRegulyDoStatystyk[]>();
  const poRegule = new Map<string, SprawdzenieRegulyDoStatystyk[]>();
  for (const s of sprawdzenia) {
    (poTradzie.get(s.tradeId) ?? poTradzie.set(s.tradeId, []).get(s.tradeId)!).push(s);
    (poRegule.get(s.ruleId) ?? poRegule.set(s.ruleId, []).get(s.ruleId)!).push(s);
  }

  let tradyOcenione = 0;
  let tradyNiezgodne = 0;
  let tradyNieocenione = liczbaTradowBezOceny;
  for (const lista of poTradzie.values()) {
    const ocenione = lista.filter((s) => s.verdict === "pass" || s.verdict === "fail");
    if (ocenione.length === 0) {
      tradyNieocenione += 1;
      continue;
    }
    tradyOcenione += 1;
    if (ocenione.some((s) => s.verdict === "fail")) tradyNiezgodne += 1;
  }
  const tradyZgodne = tradyOcenione - tradyNiezgodne;

  const statyRegul: StatyReguly[] = [...poRegule.entries()].map(([ruleId, lista]) => {
    const rPass = lista.filter((s) => s.verdict === "pass" && s.rMultiple !== null).map((s) => s.rMultiple as number);
    const rFail = lista.filter((s) => s.verdict === "fail" && s.rMultiple !== null).map((s) => s.rMultiple as number);
    return {
      ruleId,
      ruleText: lista[0].ruleText,
      ...liczniki(lista),
      sredniaRPrzyDotrzymaniu: srednia(rPass),
      sredniaRPrzyZlamaniu: srednia(rFail),
      probaRPrzyDotrzymaniu: rPass.length,
      probaRPrzyZlamaniu: rFail.length,
    };
  });
  // Najczesciej lamane na gorze; remis rozstrzyga id, zeby kolejnosc byla stabilna.
  statyRegul.sort((a, b) => b.niezgodne - a.niezgodne || a.ruleId.localeCompare(b.ruleId));

  const wypowiedzi = sprawdzenia.filter((s) => s.userVerdict !== null);
  const zgadzaSie = wypowiedzi.filter((s) => s.userVerdict === "agree").length;

  return {
    reguly: liczniki(sprawdzenia),
    trady: {
      ocenione: tradyOcenione,
      zgodne: tradyZgodne,
      niezgodne: tradyNiezgodne,
      nieocenione: tradyNieocenione,
      zgodnoscPct: procent(tradyZgodne, tradyOcenione),
    },
    poRegule: statyRegul,
    zgodaUzytkownika: {
      wypowiedzi: wypowiedzi.length,
      zgadzaSie,
      niezgadzaSie: wypowiedzi.length - zgadzaSie,
      zgodaPct: procent(zgadzaSie, wypowiedzi.length),
    },
  };
}
