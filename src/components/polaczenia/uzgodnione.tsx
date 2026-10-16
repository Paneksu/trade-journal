"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { cofnijDopasowanieAkcja } from "@/lib/actions/broker";
import { cx } from "@/lib/classes";
import { pnlClass } from "@/lib/format";
import type { UzgodnioneWiersz } from "@/lib/queries/broker";

import { czas, klasaPrzycisku, kwota, RODZAJ_DOPASOWANIA, Zywy } from "./wspolne";

/* »Uzgodnione z rachunku«: wynik »było → jest« z możliwością cofnięcia. Kolor tylko na kwotach zysku i straty. */

function Wiersz({ w, strefa, kompakt }: { w: UzgodnioneWiersz; strefa: string; kompakt: boolean }) {
  const [pyta, setPyta] = useState(false);
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const cofnij = () =>
    start(async () => {
      const r = await cofnijDopasowanieAkcja(w.brokerTradeId);
      setPyta(false);
      setInfo(r.ok ? { tekst: r.komunikat ?? "Cofnięte.", blad: false } : { tekst: r.error ?? "Nie udało się cofnąć.", blad: true });
    });
  return (
    <li className="border-b border-line py-3" data-testid={`broker-uzgodnione-${w.brokerTradeId}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-karta text-text">
            <Link href={`/trades/${w.tradeId}`} className="przejscie hover:text-accent">
              <span className="num">#{w.tradeId}</span> <span className="num">{w.contract}</span> {w.direction} <span className="num">{w.quantity}</span>
            </Link>
          </p>
          <p className="text-meta text-muted">
            {czas(w.entryTime, strefa)}
            {w.accountName ? ` · ${w.accountName}` : ""} · {RODZAJ_DOPASOWANIA[w.matchKind] ?? w.matchKind}
          </p>
        </div>
        <div className="text-right">
          <p className="num text-karta">
            <span className="sr-only">było </span>
            <span className={pnlClass(w.pnlPrzed)}>{kwota(w.pnlPrzed)}</span>
            <span className="text-muted" aria-hidden>
              {" → "}
            </span>
            <span className="sr-only"> jest </span>
            <span className={pnlClass(w.pnlPo)}>{kwota(w.pnlPo)}</span>
          </p>
          {!kompakt && (
            <p className="num text-meta text-muted">
              opłaty {w.feesCents === null ? "brak" : `${(w.feesCents / 100).toFixed(2)}`} {w.feeSource === "broker" ? "(z pliku)" : w.feeSource === "rate" ? "(wg stawki)" : ""}
              {w.roznicaCenty !== null && <> · poślizg i opłaty {kwota(w.roznicaCenty)}</>}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!pyta ? (
          <button type="button" data-testid={`broker-cofnij-dopasowanie-${w.brokerTradeId}`} className={klasaPrzycisku(false)} onClick={() => setPyta(true)}>
            Cofnij
          </button>
        ) : (
          <>
            <span className="text-meta text-muted">Wynik wróci do poprzedniego, a trade nie będzie dopasowywany sam.</span>
            <button type="button" data-testid={`broker-cofnij-dopasowanie-potwierdz-${w.brokerTradeId}`} className={klasaPrzycisku(true)} disabled={trwa} onClick={cofnij}>
              {trwa ? "Cofam…" : "Tak, cofnij"}
            </button>
            <button type="button" className={klasaPrzycisku(false)} disabled={trwa} onClick={() => setPyta(false)}>
              Anuluj
            </button>
          </>
        )}
        <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
      </div>
    </li>
  );
}

export function UzgodnioneLista({ wiersze, strefa, kompakt = false }: { wiersze: UzgodnioneWiersz[]; strefa: string; kompakt?: boolean }) {
  if (wiersze.length === 0) {
    return <p className={cx("text-meta text-muted")} data-testid="broker-uzgodnione-puste">Nic jeszcze nie uzgodniono z rachunkiem. Po imporcie dopasowane trade&apos;y pojawią się tutaj z wynikiem „było → jest”.</p>;
  }
  return (
    <ul>
      {wiersze.map((w) => (
        <Wiersz key={w.brokerTradeId} w={w} strefa={strefa} kompakt={kompakt} />
      ))}
    </ul>
  );
}
