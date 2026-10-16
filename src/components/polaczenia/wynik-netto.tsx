"use client";

import { useState, useTransition } from "react";

import { przeliczHistorieAkcja, ustawKlaseInstrumentuAkcja, zapiszStawkiKontaAkcja } from "@/lib/actions/broker";
import { cx } from "@/lib/classes";
import { money, pnlClass } from "@/lib/format";
import type { PodgladHistorii } from "@/lib/decyzje/broker";
import type { InstrumentZKlasa, KontoZeStawkami, StanOplat } from "@/lib/queries/broker";

import { klasaPrzycisku, POLE_KLASA, Zywy } from "./wspolne";

/* Wynik netto (ADR-034 pkt 5): stan opłat, przeliczenie historii z podglądem, stawki kont nie-prop i klasy kontraktów. */

const naPole = (c: number | null): string => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));

export function StawkiKonta({ konto, idPrefiks = "stawki" }: { konto: KontoZeStawkami; idPrefiks?: string }) {
  const [mini, setMini] = useState(naPole(konto.feeRtMiniCents));
  const [micro, setMicro] = useState(naPole(konto.feeRtMicroCents));
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const zapisz = () =>
    start(async () => {
      const r = await zapiszStawkiKontaAkcja(konto.id, mini, micro);
      setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Zapisano.", blad: false });
    });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        zapisz();
      }}
      data-testid={`stawki-konto-${konto.id}`}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={`${idPrefiks}-mini-${konto.id}`} className="block text-meta text-muted">
            Opłata za kontrakt mini (USD, w obie strony)
          </label>
          <input id={`${idPrefiks}-mini-${konto.id}`} data-testid={`stawka-mini-${konto.id}`} inputMode="decimal" autoComplete="off" value={mini} onChange={(e) => setMini(e.target.value)} placeholder="brak stawki" className={cx(POLE_KLASA, "num")} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefiks}-micro-${konto.id}`} className="block text-meta text-muted">
            Opłata za kontrakt micro (USD, w obie strony)
          </label>
          <input id={`${idPrefiks}-micro-${konto.id}`} data-testid={`stawka-micro-${konto.id}`} inputMode="decimal" autoComplete="off" value={micro} onChange={(e) => setMicro(e.target.value)} placeholder="brak stawki" className={cx(POLE_KLASA, "num")} />
        </div>
        <button type="submit" data-testid={`stawki-zapisz-${konto.id}`} className={klasaPrzycisku(false)} disabled={trwa}>
          {trwa ? "Zapisuję…" : "Zapisz stawki"}
        </button>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </form>
  );
}

export function KlasaInstrumentu({ instrument }: { instrument: InstrumentZKlasa }) {
  const [klasa, setKlasa] = useState<string>(instrument.sizeClass ?? "");
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const id = `klasa-${instrument.id}`;
  return (
    <div className="space-y-1" data-testid={`klasa-instrumentu-${instrument.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="num min-w-14 text-karta text-text">
          {instrument.symbol}
        </label>
        <select id={id} data-testid={`klasa-wybor-${instrument.id}`} value={klasa} onChange={(e) => setKlasa(e.target.value)} className={cx(POLE_KLASA, "w-auto min-w-40 cursor-pointer")}>
          <option value="">brak klasy</option>
          <option value="mini">mini</option>
          <option value="micro">micro</option>
        </select>
        <button
          type="button"
          data-testid={`klasa-zapisz-${instrument.id}`}
          className={klasaPrzycisku(false)}
          disabled={trwa}
          onClick={() =>
            start(async () => {
              const r = await ustawKlaseInstrumentuAkcja(instrument.id, klasa);
              setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: `${instrument.symbol}: ${r.komunikat ?? "Zapisano."}`, blad: false });
            })
          }
        >
          Zapisz klasę
        </button>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </div>
  );
}

type Przelicz = { ok: true; podglad: PodgladHistorii; zapisano: boolean } | { ok: false; komunikat: string };

function PrzeliczHistorie({ stan }: { stan: StanOplat }) {
  const [trwa, start] = useTransition();
  const [wynik, setWynik] = useState<Przelicz | null>(null);
  const uruchom = (zapisz: boolean) =>
    start(async () => {
      setWynik(await przeliczHistorieAkcja(zapisz));
    });
  const p = wynik && wynik.ok ? wynik.podglad : null;
  return (
    <div className="space-y-3">
      <p className="text-karta text-text" data-testid="oplaty-stan">
        <span className="num">{stan.bezOplat}</span> z <span className="num">{stan.razem}</span> trade&apos;ów bez opłat.
      </p>
      <p className="text-meta text-muted">
        Przeliczenie dotyczy tylko trade&apos;ów bez kwoty z rachunku (do przeliczenia: <span className="num">{stan.doPrzeliczenia}</span>). Trade z kwotą z rachunku zostaje nietknięty, bo jego wynik jest faktem.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="przelicz-historie-podglad" className={klasaPrzycisku(false)} disabled={trwa} onClick={() => uruchom(false)}>
          {trwa && !wynik ? "Liczę podgląd…" : "Przelicz historię z opłatami"}
        </button>
        {wynik && wynik.ok && !wynik.zapisano && (
          <button type="button" data-testid="przelicz-historie-zastosuj" className={klasaPrzycisku(true)} disabled={trwa || wynik.podglad.zmieni === 0} onClick={() => uruchom(true)}>
            {trwa ? "Zapisuję…" : `Zastosuj (${wynik.podglad.zmieni})`}
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" data-testid="przelicz-historie-wynik">
        {wynik && !wynik.ok && <p className="text-meta text-loss">{wynik.komunikat}</p>}
        {p && wynik && wynik.ok && (
          <div className="space-y-1.5 rounded-[var(--radius-tab)] border border-line-strong p-3 text-meta text-muted">
            <p className="text-karta text-text">{wynik.zapisano ? "Zapisano przeliczenie." : "Podgląd (nic nie zapisano)."}</p>
            <p>
              Kandydatów: <span className="num text-text">{p.kandydaci}</span> · zmieni wynik: <span className="num text-text">{p.zmieni}</span> · suma różnicy:{" "}
              <span className={cx("num", pnlClass(p.sumaRoznicyCenty))}>{money(p.sumaRoznicyCenty, { sign: true })}</span> · bez stawki (zostają bez zmian): <span className="num text-text">{p.bezStawki}</span>
            </p>
            {p.bezStawki > 0 && <p>Dla trade&apos;ów bez stawki ustaw stawkę konta lub klasę kontraktu instrumentu poniżej.</p>}
            {p.bledy.length > 0 && (
              <ul className="list-disc pl-5">
                {p.bledy.slice(0, 20).map((b) => (
                  <li key={b.tradeId}>
                    Trade #{b.tradeId}: {b.powod}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function WynikNetto({ stan, konta, instrumenty }: { stan: StanOplat; konta: KontoZeStawkami[]; instrumenty: InstrumentZKlasa[] }) {
  const bezKlasy = instrumenty.filter((i) => i.sizeClass === null);
  const nieProp = konta.filter((k) => k.type !== "prop");
  return (
    <div className="space-y-6">
      <PrzeliczHistorie stan={stan} />
      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-karta text-text">Stawki opłat kont (nie-prop)</h3>
        <p className="text-meta text-muted">Opłata za kontrakt w obie strony: prowizja, giełda i NFA. Puste pole znaczy „brak stawki”, a wynik zostaje wtedy brutto z flagą. Stawki kont prop idą z reguł (Prop, konto, przypnij preset).</p>
        {nieProp.length === 0 ? (
          <p className="text-meta text-muted">Brak kont innych niż prop.</p>
        ) : (
          nieProp.map((k) => (
            <div key={k.id} className="space-y-2 rounded-[var(--radius-tab)] border border-line-strong p-3">
              <p className="text-karta text-text">{k.name}</p>
              <StawkiKonta konto={k} idPrefiks="wn" />
            </div>
          ))
        )}
      </div>
      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-karta text-text">Klasa kontraktu instrumentów</h3>
        {bezKlasy.length === 0 ? (
          <p className="text-meta text-muted">Wszystkie instrumenty mają klasę kontraktu (mini albo micro).</p>
        ) : (
          <>
            <p className="text-meta text-muted">Te instrumenty nie mają klasy, więc ich trade&apos;y nie dostają opłat ze stawki.</p>
            <div className="space-y-3">
              {bezKlasy.map((i) => (
                <KlasaInstrumentu key={i.id} instrument={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
