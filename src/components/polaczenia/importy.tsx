"use client";

import { useState, useTransition } from "react";

import { cofnijImportAkcja } from "@/lib/actions/broker";
import type { ImportWiersz } from "@/lib/queries/broker";

import { czas, klasaPrzycisku, Modal, nazwaFormatu, ZRODLO_IMPORTU, Zywy } from "./wspolne";

/* Historia importów z cofnięciem. Cofnięcie jest destrukcyjne, więc przed nim pokazujemy, co dokładnie zostanie cofnięte. */

const STATUSY: Record<string, string> = { committed: "zastosowany", reverted: "cofnięty", rejected: "odrzucony" };

function Cofnij({ imp }: { imp: ImportWiersz }) {
  const [otwarty, setOtwarty] = useState(false);
  const [trwa, start] = useTransition();
  const [info, setInfo] = useState<{ tekst: string; blad: boolean } | null>(null);
  const wykonaj = () =>
    start(async () => {
      const r = await cofnijImportAkcja(imp.id);
      setOtwarty(false);
      if (r.ok) {
        const uwagi = r.uwagi.length ? ` Uwagi: ${r.uwagi.join(" ")}` : "";
        setInfo({ tekst: `Cofnięto import #${imp.id}: usunięto ${r.usunieteWypelnienia} wypełnień, odpięto ${r.odpiete} dopasowań, skasowano ${r.skasowaneTrady} utworzonych trade'ów.${uwagi}`, blad: false });
      } else setInfo({ tekst: r.komunikat, blad: true });
    });
  return (
    <div>
      <button type="button" data-testid={`broker-cofnij-import-${imp.id}`} className={klasaPrzycisku(false)} onClick={() => setOtwarty(true)}>
        Cofnij import
      </button>
      <Zywy blad={info?.blad}>{info?.tekst}</Zywy>
      <Modal open={otwarty} onOpenChange={setOtwarty} tytul={`Cofnąć import #${imp.id}?`} opis="Cofnięcie usuwa dane tego importu. Wypełnień ani wyniku nie da się odtworzyć inaczej niż ponownym wgraniem pliku." testid={`broker-cofnij-import-okno-${imp.id}`}>
        <ul className="list-disc space-y-1.5 pl-5 text-karta text-text">
          <li>Wypełnienia i zdarzenia z opłatami z tego importu zostaną usunięte, a trade&apos;y brokera przeliczone z tego, co zostało.</li>
          <li>
            Dopasowania (<span className="num">{imp.tradesMatched}</span>) zostaną odpięte, a wynik trade&apos;ów wróci do poprzedniego.
          </li>
          <li>
            Trade&apos;y utworzone przez ten import (<span className="num">{imp.tradesCreated}</span>) zostaną skasowane bez nagrobka.
          </li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" data-testid={`broker-cofnij-import-potwierdz-${imp.id}`} className={klasaPrzycisku(true)} disabled={trwa} onClick={wykonaj}>
            {trwa ? "Cofam…" : "Cofnij import"}
          </button>
          <button type="button" className={klasaPrzycisku(false)} disabled={trwa} onClick={() => setOtwarty(false)}>
            Anuluj
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function ImportyLista({ importy, strefa }: { importy: ImportWiersz[]; strefa: string }) {
  if (importy.length === 0) return <p className="text-meta text-muted">Brak importów. Pierwszy plik wgraj ręcznie albo użyj „Pobierz teraz”.</p>;
  return (
    <ul>
      {importy.map((i) => (
        <li key={i.id} className="border-b border-line py-3" data-testid={`broker-import-${i.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-karta text-text">
                <span className="num">#{i.id}</span> {nazwaFormatu(i.format)} <span className="text-muted">· {ZRODLO_IMPORTU[i.origin] ?? i.origin}</span>
              </p>
              <p className="text-meta text-muted">{czas(i.createdAt, strefa)} · strefa {i.tz}</p>
              <p className="num text-meta text-muted">
                wypełnienia +{i.fillsNew}, duplikaty {i.fillsDuplicate} · uzgodnione {i.tradesMatched} · utworzone {i.tradesCreated} · do decyzji {i.pendingDecisions} · pominięte wiersze {i.rowsSkipped}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 text-meta text-muted" data-testid={`broker-import-status-${i.id}`}>
                {STATUSY[i.status] ?? i.status}
              </span>
              {i.status === "committed" && <Cofnij imp={i} />}
            </div>
          </div>
          {i.warnings.length > 0 && (
            <details className="mt-2">
              <summary className="przejscie cursor-pointer text-meta text-muted hover:text-text">Ostrzeżenia ({i.warnings.length})</summary>
              <ul className="mt-1.5 space-y-1 text-meta text-muted">
                {i.warnings.map((w, k) => (
                  <li key={k}>{w.message}</li>
                ))}
              </ul>
            </details>
          )}
          {i.note && <p className="mt-1 text-meta text-muted">{i.note}</p>}
        </li>
      ))}
    </ul>
  );
}
