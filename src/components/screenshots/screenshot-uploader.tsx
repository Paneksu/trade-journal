"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ClipboardPaste } from "lucide-react";

import { ErrorMessage, Label, Select } from "@/components/ui/base";
import {
  addDayScreenshots,
  removeDayScreenshot,
  setDayScreenshotInterval,
} from "@/lib/actions/journal";
import { addTradeScreenshots, removeScreenshot, setScreenshotInterval } from "@/lib/actions/trades";
import { BAZA_WYSOKOSCI_WIERSZA_DUZA } from "@/lib/domain/galeria";
import { INTERWALY } from "@/lib/domain/interwaly";
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
 *
 * Interwal (ADR-015): jeden `<select>` nad strefa wgrywania, wspolny dla
 * calej paczki. Wartosc zostaje w stanie miedzy wgraniami - typowy przeplyw
 * to kilka zrzutow z tego samego interwalu pod rzad, wiec przestawianie
 * selecta za kazdym razem byloby kara za normalne uzycie.
 */

export function ScreenshotUploader({
  cel,
  shots,
  opis,
  kompakt = false,
}: {
  cel: CelZrzutow;
  shots: Shot[];
  opis: string;
  /**
   * Wariant dla karty pojedynczego trade'a (2026-08-29): zamiast duzej ramki
   * jeden waski pasek, a zdjecia dostaja wieksza baze wiersza. Ctrl+V slucha
   * calego dokumentu, wiec strefa nigdy nie byla droga, ktora sie tu chodzi -
   * zabierala tylko miejsce temu, co na tej stronie jest trescia.
   */
  kompakt?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [blad, setBlad] = useState<string | null>(null);
  const [wgrane, setWgrane] = useState(false);
  const [interwal, setInterwal] = useState("");
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
    if (interwal) dane.set("interval", interwal);

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

  async function zmienInterval(id: number, w: string) {
    if (cel.typ === "trade") await setScreenshotInterval(id, w);
    else await setDayScreenshotInterval(id, w);
  }

  const komunikat = pending
    ? "Wgrywam…"
    : wgrane
      ? "Wgrane."
      : komplet
        ? `Limit ${MAX_ZRZUTOW} zrzutów — usuń któryś, żeby dodać nowy.`
        : "Wklej zrzut (Ctrl+V) albo przeciągnij plik";

  const wybierzPlik = (
    <label>
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
  );

  const wyborInterwalu = (
    <Select
      id="zrzut-interwal"
      value={interwal}
      onChange={(e) => setInterwal(e.target.value)}
      className="max-w-40"
    >
      <option value="">— nie podano —</option>
      {INTERWALY.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </Select>
  );

  if (kompakt) {
    return (
      <div className="space-y-3 p-4">
        <ScreenshotGrid
          shots={shots}
          opis={opis}
          onUsun={usun}
          onZmienInterval={zmienInterval}
          baza={BAZA_WYSOKOSCI_WIERSZA_DUZA}
        />

        {blad && <ErrorMessage>{blad}</ErrorMessage>}

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            wyslij(Array.from(e.dataTransfer.files));
          }}
          ref={strefa}
          data-wklejanie="czekam"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2"
        >
          <ClipboardPaste size={15} className="shrink-0 text-faint" aria-hidden />
          <p className="text-xs text-muted" aria-live="polite">
            {komunikat}
          </p>
          <span className="liczba text-xs text-faint">
            {shots.length}/{MAX_ZRZUTOW}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Label htmlFor="zrzut-interwal">Interwał</Label>
            {wyborInterwalu}
            {!komplet && <div className="w-52">{wybierzPlik}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {/* Zdjecia ida pierwsze - to one sa trescia wpisu. Strefa wgrywania
          zostaje pod nimi, blizej miejsca, w ktorym konczy sie ogladanie. */}
      <ScreenshotGrid shots={shots} opis={opis} onUsun={usun} onZmienInterval={zmienInterval} />

      {blad && <ErrorMessage>{blad}</ErrorMessage>}

      <div className="space-y-1.5">
        <Label htmlFor="zrzut-interwal">Interwał nowych zrzutów</Label>
        {wyborInterwalu}
      </div>

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
          {komunikat}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          PNG, JPEG, WEBP lub AVIF, do 10 MB. {shots.length}/{MAX_ZRZUTOW}
        </p>

        {!komplet && <div className="mt-3">{wybierzPlik}</div>}
      </div>
    </div>
  );
}
