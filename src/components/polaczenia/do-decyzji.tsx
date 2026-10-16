"use client";

import { useState, useTransition } from "react";

import { dopasujPonownieAkcja, dopasujRecznieAkcja, pominTradeBrokeraAkcja, przypiszKontoAkcja, utworzTradeZBrokeraAkcja, zaktualizujKwoteAkcja } from "@/lib/actions/broker";
import { cx } from "@/lib/classes";
import { pnlClass } from "@/lib/format";
import type { DoDecyzjiWiersz, ImportWiersz, KontoPolaczone, NettoZmienioneWiersz, PominietyWiersz } from "@/lib/queries/broker";

import { czas, klasaPrzycisku, kwota, nazwaFormatu, POLE_KLASA, Zywy, type KontoDziennika } from "./wspolne";

/* »Do decyzji«: trade'y brokera bez dopasowania z powodem i kandydatami. Każda akcja zostawia komunikat w strefie aria-live. */

function Wiersz({ w, strefa }: { w: DoDecyzjiWiersz; strefa: string }) {
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const uruchom = (f: () => Promise<{ ok?: boolean; komunikat?: string; error?: string }>) =>
    start(async () => {
      const r = await f();
      setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Gotowe.", blad: false });
    });
  const mozeUtworzyc = w.accountId !== null && w.instrumentId !== null;
  return (
    <li className="border-b border-line py-3" data-testid={`broker-do-decyzji-${w.brokerTradeId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-karta text-text">
          <span className="num">{w.contract}</span> {w.direction} <span className="num">{w.quantity}</span>
          <span className="text-muted"> · {w.accountName ?? (w.last4 ? `konto …${w.last4}` : "konto u brokera")}</span>
        </p>
        <p className="num text-karta">
          <span className="sr-only">netto </span>
          <span className={pnlClass(w.netCents)}>{kwota(w.netCents)}</span>
          <span className="font-sans text-meta text-muted"> {w.feeSource === "broker" ? "(opłaty z pliku)" : w.feeSource === "rate" ? "(opłaty wg stawki)" : ""}</span>
        </p>
      </div>
      <p className="num text-meta text-muted">
        {czas(w.entryTime, strefa)} → {w.exitTime ? czas(w.exitTime, strefa) : "otwarta"}
      </p>
      <p className="text-meta text-muted">
        {w.stan === "ambiguous" ? "Niejednoznaczne" : "Bez odpowiednika"}
        {w.powod ? `: ${w.powod}` : ""}.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {w.kandydaci.map((k) => (
          <button
            key={k.tradeId}
            type="button"
            data-testid={`broker-dopasuj-${w.brokerTradeId}-${k.tradeId}`}
            className={klasaPrzycisku(false)}
            disabled={trwa}
            title={`Trade #${k.tradeId}: ${czas(k.entryTime, strefa)}, ${k.contracts} kontr.`}
            onClick={() => uruchom(() => dopasujRecznieAkcja(w.brokerTradeId, k.tradeId))}
          >
            Dopasuj do <span className="num">#{k.tradeId}</span>
          </button>
        ))}
        <button
          type="button"
          data-testid={`broker-utworz-trade-${w.brokerTradeId}`}
          className={klasaPrzycisku(false)}
          disabled={trwa || !mozeUtworzyc}
          title={mozeUtworzyc ? undefined : w.accountId === null ? "Najpierw przypisz konto dziennika do konta u brokera." : "Kontrakt nie ma instrumentu w dzienniku."}
          onClick={() => uruchom(() => utworzTradeZBrokeraAkcja(w.brokerTradeId))}
        >
          Utwórz trade
        </button>
        <button type="button" data-testid={`broker-pomin-${w.brokerTradeId}`} className={klasaPrzycisku(false)} disabled={trwa} onClick={() => uruchom(() => pominTradeBrokeraAkcja(w.brokerTradeId))}>
          Pomiń
        </button>
      </div>
      {w.kandydaci.length > 0 && (
        <p className="mt-1.5 text-meta text-muted">
          Kandydaci:{" "}
          {w.kandydaci.map((k) => (
            <span key={k.tradeId} className="num mr-3 inline-block">
              #{k.tradeId} {czas(k.entryTime, strefa)} · {k.contracts} kontr. · <span className={pnlClass(k.pnl)}>{kwota(k.pnl)}</span>
            </span>
          ))}
        </p>
      )}
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </li>
  );
}

function WierszNetto({ w, strefa }: { w: NettoZmienioneWiersz; strefa: string }) {
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  return (
    <li className="border-b border-line py-3" data-testid={`broker-netto-zmienione-${w.brokerTradeId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-karta text-text">
          Rachunek zmienił netto trade&apos;a #{w.tradeId}: <span className="num">{kwota(w.bylo)}</span> → <span className="num">{kwota(w.jest)}</span>
          <span className="text-muted"> · {w.contract} {w.direction} · {czas(w.entryTime, strefa)}</span>
        </p>
        <button
          type="button"
          data-testid={`broker-netto-zaktualizuj-${w.brokerTradeId}`}
          className={klasaPrzycisku(false)}
          disabled={trwa}
          onClick={() =>
            start(async () => {
              const r = await zaktualizujKwoteAkcja(w.brokerTradeId);
              setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Gotowe.", blad: false });
            })
          }
        >
          Zaktualizuj kwotę
        </button>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </li>
  );
}

function WierszPominiety({ w, strefa }: { w: PominietyWiersz; strefa: string }) {
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  return (
    <li className="border-b border-line py-3" data-testid={`broker-pominiety-${w.brokerTradeId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-karta text-text">
          <span className="num">{w.contract}</span> {w.direction} <span className="num">{w.quantity}</span>
          <span className="text-muted"> · {w.accountName ?? "konto u brokera"} · {czas(w.entryTime, strefa)}</span>
        </p>
        <button
          type="button"
          data-testid={`broker-wroc-do-decyzji-${w.brokerTradeId}`}
          className={klasaPrzycisku(false)}
          disabled={trwa}
          onClick={() =>
            start(async () => {
              const r = await pominTradeBrokeraAkcja(w.brokerTradeId, true);
              setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Gotowe.", blad: false });
            })
          }
        >
          Wróć do decyzji
        </button>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </li>
  );
}

export function DoDecyzjiLista({
  wiersze,
  odrzucone,
  strefa,
  nettoZmienione = [],
  pominiete = [],
}: {
  wiersze: DoDecyzjiWiersz[];
  odrzucone: ImportWiersz[];
  strefa: string;
  nettoZmienione?: NettoZmienioneWiersz[];
  pominiete?: PominietyWiersz[];
}) {
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="broker-dopasuj-ponownie"
          className={klasaPrzycisku(false)}
          disabled={trwa}
          onClick={() =>
            start(async () => {
              const r = await dopasujPonownieAkcja();
              setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Gotowe.", blad: false });
            })
          }
        >
          {trwa ? "Dopasowuję…" : "Dopasuj ponownie"}
        </button>
        <span className="text-meta text-muted">Stosuje dopasowania 1:1 dla wszystkich czekających trade&apos;ów (np. po dopisaniu trade&apos;ów do dziennika).</span>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
      {wiersze.length === 0 ? (
        <p className="text-meta text-muted" data-testid="broker-do-decyzji-puste">Nic nie czeka na decyzję.</p>
      ) : (
        <ul>
          {wiersze.map((w) => (
            <Wiersz key={w.brokerTradeId} w={w} strefa={strefa} />
          ))}
        </ul>
      )}
      {nettoZmienione.length > 0 && (
        <div className="space-y-2" data-testid="broker-netto-zmienione">
          <h3 className="text-karta text-text">Rachunek zmienił netto</h3>
          <p className="text-meta text-muted">Dopasowania ręczne, z sugestii i utworzone z rachunku zmieniasz tylko Ty. Automat ich nie rusza.</p>
          <ul>
            {nettoZmienione.map((w) => (
              <WierszNetto key={w.brokerTradeId} w={w} strefa={strefa} />
            ))}
          </ul>
        </div>
      )}
      {pominiete.length > 0 && (
        <div className="space-y-2" data-testid="broker-pominiete">
          <h3 className="text-karta text-text">Pominięte</h3>
          <p className="text-meta text-muted">Pominąłeś je albo cofnąłeś dopasowanie, więc automat ich nie rusza. Tu możesz je przywrócić do decyzji.</p>
          <ul>
            {pominiete.map((w) => (
              <WierszPominiety key={w.brokerTradeId} w={w} strefa={strefa} />
            ))}
          </ul>
        </div>
      )}
      {odrzucone.length > 0 && (
        <div className="space-y-2" data-testid="broker-odrzucone">
          <h3 className="text-karta text-text">Odrzucone pliki z automatu (30 dni)</h3>
          <ul className="space-y-2">
            {odrzucone.map((o) => (
              <li key={o.id} className="rounded-[var(--radius-tab)] border border-line-strong px-3 py-2 text-meta text-muted">
                <span className="num text-text">#{o.id}</span> {nazwaFormatu(o.format)} · {czas(o.createdAt, strefa)}
                <br />
                {o.note ?? "Plik odrzucony bez opisu."}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* Konta u brokera: przypisanie do kont dziennika (jedno konto dziennika ma co najwyżej jedno konto u brokera). */
function KontoBrokera({ k, konta, strefa }: { k: KontoPolaczone; konta: KontoDziennika[]; strefa: string }) {
  const [trwa, start] = useTransition();
  const [wybor, setWybor] = useState("");
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const uruchom = (id: number | null) =>
    start(async () => {
      const r = await przypiszKontoAkcja(k.brokerAccountId, id);
      setInfo(r.error ? { tekst: r.error, blad: true } : { tekst: r.komunikat ?? "Gotowe.", blad: false });
    });
  const idSel = `przypisz-${k.brokerAccountId}`;
  return (
    <li className="border-b border-line py-3" data-testid={`broker-konto-${k.brokerAccountId}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-karta text-text">
            {k.platform} <span className="num text-muted">…{k.last4 ?? "????"}</span>
          </p>
          <p className="text-meta text-muted">
            {k.accountName ? <>Konto dziennika: <span className="text-text">{k.accountName}</span></> : "Nie przypisane do konta dziennika"} · ostatni import {czas(k.lastImportAt, strefa)}
          </p>
          <p className="num text-meta text-muted">
            wypełnienia {k.fills} · trade&apos;y {k.tradesTotal} · uzgodnione {k.tradesMatched} · czeka {k.tradesPending}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {k.accountId === null ? (
            <>
              <label htmlFor={idSel} className="sr-only">
                Konto dziennika dla {k.platform} …{k.last4}
              </label>
              <select id={idSel} data-testid={`broker-przypisz-konto-${k.brokerAccountId}`} value={wybor} onChange={(e) => setWybor(e.target.value)} className={cx(POLE_KLASA, "w-auto min-w-48 cursor-pointer")}>
                <option value="">Wybierz konto dziennika</option>
                {konta.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.brokerAccountId !== null}>
                    {c.name}
                    {c.brokerAccountId !== null ? " (zajęte)" : ""}
                  </option>
                ))}
              </select>
              <button type="button" data-testid={`broker-przypisz-zapisz-${k.brokerAccountId}`} className={klasaPrzycisku(true)} disabled={trwa || wybor === ""} onClick={() => uruchom(Number(wybor))}>
                Przypisz konto
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid={`broker-odepnij-${k.brokerAccountId}`}
              className={klasaPrzycisku(false)}
              disabled={trwa}
              onClick={() => {
                if (window.confirm("Odpiąć konto? Dopasowania tego konta zostaną cofnięte, a wynik trade'ów wróci do poprzedniego.")) uruchom(null);
              }}
            >
              Odepnij
            </button>
          )}
        </div>
      </div>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
    </li>
  );
}

export function KontaBrokeraLista({ polaczone, konta, strefa }: { polaczone: KontoPolaczone[]; konta: KontoDziennika[]; strefa: string }) {
  if (polaczone.length === 0) return <p className="text-meta text-muted">Konto u brokera pojawi się tutaj po pierwszym imporcie pliku.</p>;
  return (
    <ul>
      {polaczone.map((k) => (
        <KontoBrokera key={k.brokerAccountId} k={k} konta={konta} strefa={strefa} />
      ))}
    </ul>
  );
}
