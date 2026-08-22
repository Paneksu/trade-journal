"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ClipboardPaste } from "lucide-react";

import { ErrorMessage } from "@/components/ui/base";
import { addDayScreenshots, removeDayScreenshot } from "@/lib/actions/journal";
import { addTradeScreenshots, removeScreenshot } from "@/lib/actions/trades";
import { bladLimitu, MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { ScreenshotGrid } from "./screenshot-grid";
import type { CelZrzutow, Shot } from "./typy";

/**
 * Wgrywanie zrzutow do wpisu, ktory juz istnieje w bazie - trade w edycji albo
 * dzien dziennika. Dzien bez transakcji tez ma czego dowodzic: wykres, na
 * ktorym setupu nie bylo, bywa wiecej wart niz zdanie o nim.
 *
 * Wklejanie ze schowka jest glowna droga - zrzut z platformy leci Ctrl+V, bez
 * zapisywania pliku na dysk. Pole wyboru pliku zostaje dla telefonu.
 */

export function ScreenshotUploader({
  cel,
  shots,
  opis,
}: {
  cel: CelZrzutow;
  shots: Shot[];
  opis: string;
}) {
  const [pending, startTransition] = useTransition();
  const [blad, setBlad] = useState<string | null>(null);
  const [wgrane, setWgrane] = useState(false);
  // Znacznik gotowosci nasluchu zapisujemy wprost w DOM, nie w stanie: reguly
  // Reacta slusznie zabraniaja setState w ciele efektu, a atrybut jest tu tylko
  // sygnalem "Ctrl+V juz dziala" - dla testu i dla podgladu w przegladarce.
  const strefa = useRef<HTMLDivElement>(null);
  const komplet = shots.length >= MAX_ZRZUTOW;

  function wyslij(files: File[]) {
    const obrazy = files.filter((f) => f.type.startsWith("image/"));
    if (obrazy.length === 0) return;

    const limit = bladLimitu(shots.length, obrazy.length);
    if (limit) {
      setBlad(limit);
      return;
    }

    const dane = new FormData();
    if (cel.typ === "trade") {
      dane.set("tradeId", String(cel.tradeId));
    } else {
      dane.set("day", cel.day);
      if (cel.accountId) dane.set("accountId", String(cel.accountId));
      if (cel.backtestSessionId)
        dane.set("backtestSessionId", String(cel.backtestSessionId));
    }
    for (const f of obrazy) dane.append("shot", f);

    setBlad(null);
    startTransition(async () => {
      const wynik =
        cel.typ === "trade"
          ? await addTradeScreenshots(dane)
          : await addDayScreenshots(dane);
      setBlad(wynik.error ?? null);
      if (!wynik.error) {
        setWgrane(true);
        window.setTimeout(() => setWgrane(false), 2000);
      }
    });
  }

  // Ctrl+V dziala na calym panelu, nie tylko po kliknieciu w ramke: po zrobieniu
  // zrzutu w platformie nikt nie szuka najpierw pola do wklejenia.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      wyslij(files);
    }
    document.addEventListener("paste", onPaste);
    const wezel = strefa.current;
    if (wezel) wezel.dataset.wklejanie = "gotowe";
    return () => {
      document.removeEventListener("paste", onPaste);
      if (wezel) wezel.dataset.wklejanie = "czekam";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cel), shots.length]);

  async function usun(id: number) {
    if (cel.typ === "trade") await removeScreenshot(id);
    else await removeDayScreenshot(id);
  }

  return (
    <div className="space-y-3 p-4">
      {/* Zdjecia ida pierwsze - to one sa trescia wpisu. Strefa wgrywania
          zostaje pod nimi, blizej miejsca, w ktorym konczy sie ogladanie. */}
      <ScreenshotGrid shots={shots} opis={opis} onUsun={usun} />

      {blad && <ErrorMessage>{blad}</ErrorMessage>}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          wyslij(Array.from(e.dataTransfer.files));
        }}
        ref={strefa}
        data-wklejanie="czekam"
        className="rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface-2 px-4 py-3.5 text-center"
      >
        <ClipboardPaste
          size={18}
          className="mx-auto mb-1.5 text-faint"
          aria-hidden
        />
        <p className="text-sm text-muted" aria-live="polite">
          {pending
            ? "Wgrywam…"
            : wgrane
              ? "Wgrane."
              : komplet
                ? `Limit ${MAX_ZRZUTOW} zrzutów — usuń któryś, żeby dodać nowy.`
                : "Wklej zrzut (Ctrl+V) albo przeciągnij plik"}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          PNG, JPEG, WEBP lub AVIF, do 10 MB. {shots.length}/{MAX_ZRZUTOW}
        </p>

        {!komplet && (
          <label className="mt-3 inline-block">
            <span className="sr-only">Wybierz plik ze zrzutem</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              multiple
              disabled={pending}
              onChange={(e) => {
                wyslij(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:border-faint"
            />
          </label>
        )}
      </div>
    </div>
  );
}
