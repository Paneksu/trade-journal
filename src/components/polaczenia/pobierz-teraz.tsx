"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { sprawdzNowyImportAkcja } from "@/lib/actions/broker";
import { plural } from "@/lib/format";
import type { ImportWiersz } from "@/lib/queries/broker";

import { klasaPrzycisku, Zywy } from "./wspolne";

/*
 * »Pobierz teraz« (ADR-034 pkt 1): jeden wlot. Pokazuje instrukcję eksportu i czeka na plik: co 3 s przez 3 minuty pyta serwer,
 * czy od chwili kliknięcia przyszedł import (z automatu albo ręczny). Niczego nie zapisuje i nie łączy się z platformą.
 */

const CO_MS = 3000;
const LIMIT_MS = 180_000;

export type StanAutomatuUi = { skonfigurowane: boolean; aktywnyToken: boolean };

type Stan =
  | { k: "bezczynny" }
  | { k: "czeka"; od: string }
  | { k: "znaleziono"; imp: ImportWiersz }
  | { k: "minelo" };

export function zdanieWyniku(i: ImportWiersz): string {
  if (i.status === "rejected") return `Plik odrzucony: ${i.note ?? "powód jest w sekcji Do decyzji"}`;
  const uzgodnione = i.tradesMatched + i.tradesCreated;
  const n = uzgodnione + i.pendingDecisions;
  if (n === 0) {
    return i.fillsNew > 0
      ? `Odebrano plik: ${i.fillsNew} nowych wypełnień, jeszcze bez gotowych trade'ów (opłaty z Cash History zasilą wynik netto).`
      : "Odebrano plik, ale nic w nim nie było nowego.";
  }
  return `Odebrano ${n} ${plural(n, "trade", "trade'y", "trade'ów")}, ${uzgodnione} uzgodnionych, ${i.pendingDecisions} do decyzji.`;
}

export function PobierzTeraz({
  automat,
  baza = "/prop/polaczenia",
  sufiks = "",

}: {
  automat: StanAutomatuUi;
  /** Adres strony z sekcjami wyniku (kotwice #uzgodnione, #do-decyzji). */
  baza?: string;
  /** Sufiks data-testid, gdy na stronie jest więcej niż jeden przycisk (kreator, Dziś). */
  sufiks?: string;

}) {
  const router = useRouter();
  const [stan, setStan] = useState<Stan>({ k: "bezczynny" });
  const wToku = useRef(false);

  const od = stan.k === "czeka" ? stan.od : null;
  useEffect(() => {
    if (!od) return;
    const start = new Date(od).getTime();
    const id = setInterval(async () => {
      if (Date.now() - start > LIMIT_MS) {
        setStan({ k: "minelo" });
        return;
      }
      if (wToku.current) return;
      wToku.current = true;
      try {
        const w = await sprawdzNowyImportAkcja(od);
        if (w.import) {
          setStan({ k: "znaleziono", imp: w.import });
          router.refresh();
        }
      } catch {
        // chwilowy błąd sieci: próbujemy przy następnym odczycie
      } finally {
        wToku.current = false;
      }
    }, CO_MS);
    return () => clearInterval(id);
  }, [od, router]);

  const czeka = stan.k === "czeka";
  return (
    <div className="space-y-3" data-pobierz-teraz>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`broker-pobierz-teraz${sufiks}`}
          className={klasaPrzycisku(true)}
          disabled={czeka}
          onClick={() => setStan({ k: "czeka", od: new Date().toISOString() })}
        >
          {czeka ? "Czekam na plik…" : "Pobierz teraz"}
        </button>
        {czeka && (
          <button type="button" className={klasaPrzycisku(false)} onClick={() => setStan({ k: "bezczynny" })}>
            Przestań czekać
          </button>
        )}
        <Link href={`${baza}#import-reczny`} className={klasaPrzycisku(false)} data-testid={`broker-wgraj-recznie-link${sufiks}`}>
          Wgraj plik ręcznie
        </Link>
      </div>

      {!automat.skonfigurowane && (
        <p className="text-meta text-loss">Import z rachunku nie jest skonfigurowany na serwerze (brak klucza BROKER_ID_HMAC_KEY), więc żaden plik nie zostanie przyjęty. Ustaw klucz i uruchom serwer ponownie.</p>
      )}
      {automat.skonfigurowane && !automat.aktywnyToken && (
        <p className="text-meta text-muted">
          Automat nie ma tokenu, więc plik z folderu Pobrane nie dotrze sam.{" "}
          <Link href="/settings/devices#automat-eksportow" className="przejscie underline underline-offset-2 hover:text-text">
            Wydaj token w Ustawieniach
          </Link>
          . Do tego czasu wgraj plik ręcznie.
        </p>
      )}

      {czeka && (
        <div className="rounded-[var(--radius-tab)] border border-line-strong p-4 text-meta text-muted" data-testid={`broker-instrukcja-krotka${sufiks}`}>
          <p className="text-karta text-text">Wyeksportuj pliki w Tradovate</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Reports, zakładka Orders, zakres dat, Go, Download CSV.</li>
            <li>Zakładka Cash History, te same daty i konto, Go, Download CSV.</li>
            <li>Oba pliki zostaw w folderze Pobrane. Automat sam je znajdzie.</li>
          </ol>
          <p className="mt-2">Sprawdzam co 3 sekundy, maksymalnie przez 3 minuty.</p>
        </div>
      )}

      <Zywy blad={stan.k === "znaleziono" && stan.imp.status === "rejected"}>
        {stan.k === "znaleziono" ? (
          <span data-testid={`broker-wynik-pobrania${sufiks}`}>
            {zdanieWyniku(stan.imp)}{" "}
            <Link href={`${baza}#uzgodnione`} className="underline underline-offset-2 hover:text-text">
              Uzgodnione
            </Link>
            {" · "}
            <Link href={`${baza}#do-decyzji`} className="underline underline-offset-2 hover:text-text">
              Do decyzji
            </Link>
          </span>
        ) : stan.k === "minelo" ? (
          "Nie widzę nowego pliku od 3 minut. Sprawdź, czy eksport się zakończył i czy automat działa, albo wgraj plik ręcznie."
        ) : czeka ? (
          "Czekam na plik."
        ) : null}
      </Zywy>
    </div>
  );
}
