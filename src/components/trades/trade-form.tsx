"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";

import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import type { Shot } from "@/components/screenshots/typy";
import { FieldInputs } from "./field-inputs";
import { Gotowosc } from "./gotowosc";
import { NewTradeShots } from "./new-trade-shots";
import { TagManager } from "./tag-manager";
import { TagPicker } from "./tag-picker";
import {
  Button,
  Checkbox,
  DataPoint,
  ErrorMessage,
  Input,
  Label,
  Panel,
  Select,
  SuccessMessage,
  Textarea,
} from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { MAX_ZRZUTOW } from "@/lib/screenshots-limit";
import { saveTrade, type FormState } from "@/lib/actions/trades";
import {
  computeTrade,
  exitPriceForAmount,
  fromLocalInput,
  type Direction,
  type ExitForAmount,
  type ExitInput,
} from "@/lib/domain/calc";
import { POWODY, POWOD_NAZWY } from "@/lib/domain/kierunek";
import { wynikTrade, type Progi } from "@/lib/domain/outcome";
import type { FieldDef } from "@/lib/fields/fields";
import {
  money,
  nazwaStrefy,
  num,
  plural,
  price,
  rValue,
  wynikClass,
  WYNIK_NAZWY,
} from "@/lib/format";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/* Formularz trade'a. Liczy wynik na zywo tym samym modulem, ktory liczy go
   po stronie serwera - dzieki temu podglad nigdy nie rozjedzie sie z zapisem. */

export type FormAccount = { id: number; name: string; currency: string; defaultRiskAmount: number | null };
export type FormInstrument = {
  id: number;
  symbol: string;
  name: string;
  tickSize: string;
  tickValue: number;
  rthFrom: string;
  rthTo: string;
  exchangeTimezone: string;
};
export type FormSession = { id: number; name: string };

/** Ksztalt jednego kawalka wyjscia przyjmowany z formularza edycji. Liczby
 * jako string, tak samo jak reszta pol formularza (entryPrice, contracts...). */
export type ExitFormValue = {
  time?: string | null;
  price?: string | null;
  contracts?: string | null;
  /** W walucie konta (dolary), nie w centach - jak top-poziomowy `brokerAmount`. */
  brokerAmount?: string | null;
  note?: string | null;
};

/** Stan jednego wiersza repeatera wyjsc. Cena i kontrakty sa kontrolowane -
 * podglad ich potrzebuje na zywo. Czas i notatka NIE - formularz z server
 * action potrafi wyzerowac kontrolowane pole po rewalidacji, a od tych dwoch
 * podglad nie zalezy, wiec zostaja niekontrolowane (`defaultTime`/`defaultNote`,
 * czytane tylko raz przy montowaniu wiersza). */
type StanWyjscia = {
  id: string;
  price: string;
  contracts: string;
  kwota: string;
  /* Czas i notatka sa KONTROLOWANE, tak jak cena i kontrakty. Czas musi byc,
     bo podglad sortuje po nim kawalki dokladnie tak, jak robi to akcja zapisu
     - bez tego "ostatnie wyjscie" w podgladzie i w zapisie to dwa rozne
     wiersze i `scalingR` potrafi zmienic znak. Notatka dla parzystosci: o tym,
     czy wiersz jest pusty, decyduja te same piec pol po obu stronach. */
  time: string;
  note: string;
};

/** Tolerancja przy porownaniach sum kontraktow - liczby z formularza to
 * stringi zamieniane na float (0.1 + 0.2 !== 0.3), jak w akcji zapisu. */
const EPS_KONTRAKTY = 1e-6;

/** Czyta liczbe tak samo jak akcja zapisu (actions/trades.ts): przecinek
 * dziesietny i spacje w tysiacach. Modulowa wersja `parse` z komponentu -
 * potrzebna tez poza nim, do wyliczenia poczatkowego stanu przelacznika
 * "czesciowe wyjscia" (patrz `poczatkoweCzesciowe`). */
function parseNum(w: string): number | null {
  if (w.trim() === "") return null;
  const n = Number(w.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Buduje poczatkowy stan wierszy z `values.exits`. Pusta tablica/brak =
 * jeden pusty wiersz. Id sa deterministyczne (indeks), bo licza sie w
 * inicjalizatorze `useState` - takie same na serwerze i po hydratacji;
 * losowe id (np. crypto.randomUUID) tutaj zrobiloby mismatch. */
function poczatkoweWyjscia(exits: ExitFormValue[] | undefined): StanWyjscia[] {
  if (!exits || exits.length === 0) {
    return [{ id: "wy-init-0", price: "", contracts: "", kwota: "", time: "", note: "" }];
  }
  return exits.map((e, i) => ({
    id: `wy-init-${i}`,
    price: e.price ?? "",
    contracts: e.contracts ?? "",
    kwota: e.brokerAmount ?? "",
    time: e.time ?? "",
    note: e.note ?? "",
  }));
}

export type TradeFormValues = {
  id?: number;
  accountId?: number | null;
  instrumentId?: number | null;
  backtestSessionId?: number | null;
  direction?: Direction;
  status?: string;
  entryTime?: string;
  entryPrice?: string;
  /** Kawalki wyjscia - zastapily pojedyncze `exitTime`/`exitPrice` (ETAP 4a,
   * czesciowe realizacje zysku). Pusta tablica albo brak = pozycja otwarta,
   * formularz pokazuje jeden pusty wiersz. `time` jest juz sformatowany pod
   * `datetime-local` (jak `entryTime`), `brokerAmount` jest w walucie konta,
   * nie w centach. */
  exits?: ExitFormValue[];
  contracts?: string;
  stopLoss?: string;
  takeProfit?: string;
  /** Kwota z rachunku brokera, w walucie konta - nie w centach. */
  brokerAmount?: string;
  mae?: string;
  mfe?: string;
  note?: string;
  /** Samopoczucie opisane slowami - zastapilo pole wlasne "nastroj" (2026-08-29). */
  moodNote?: string | null;
  /** Gotowosc psychiczna na dany dzien, 1-10. NULL = nie oceniono. */
  readiness?: number | null;
  directionCorrect?: boolean | null;
  badExecutionReason?: string | null;
  /** Zasieg calego zagrania w R - nie mylic z `mfe` (ADR-018). */
  potentialR?: string | null;
  tags?: { id: number; interval: string | null }[];
  custom?: Record<string, unknown>;
  shots?: Shot[];
};

/** Rozpoznaje, czy trade byl faktycznie skalowany - od tego zalezy poczatkowy
 * stan checkboxa "Czesciowe wyjscia" przy edycji: ukrycie repeatera nie moze
 * schowac danych, ktore juz tam sa. Zaznaczone, gdy zachodzi ktorykolwiek z
 * trzech warunkow z zadania: wiecej niz jedno wyjscie; jedyne wyjscie ma
 * wlasna liczbe kontraktow rozna od calosci pozycji (czesciowe zamkniecie);
 * albo jedyne wyjscie ma wlasna kwote z brokera lub notatke. */
function poczatkoweCzesciowe(values: TradeFormValues): boolean {
  const exits = values.exits;
  if (!exits || exits.length === 0) return false;
  if (exits.length > 1) return true;

  const jedyne = exits[0];
  const kontraktyWiersza = parseNum(jedyne.contracts ?? "");
  const kontraktyCalosci = parseNum(values.contracts ?? "");
  if (
    kontraktyWiersza !== null &&
    kontraktyCalosci !== null &&
    Math.abs(kontraktyWiersza - kontraktyCalosci) > EPS_KONTRAKTY
  ) {
    return true;
  }
  if ((jedyne.brokerAmount ?? "").trim() !== "" || (jedyne.note ?? "").trim() !== "") return true;
  return false;
}

function SubmitRow({ isEdit, onStay }: { isEdit: boolean; onStay: (v: boolean) => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        variant="primary"
        size="l"
        disabled={pending}
        onClick={() => onStay(false)}
      >
        {pending ? "Zapisuję…" : isEdit ? "Zapisz zmiany" : "Zapisz trade"}
      </Button>
      {!isEdit && (
        <Button type="submit" size="l" disabled={pending} onClick={() => onStay(true)}>
          Zapisz i dodaj kolejny
        </Button>
      )}
      <Link
        href="/trades"
        className="px-2 text-sm text-muted transition-colors duration-150 hover:text-text"
      >
        Anuluj
      </Link>
    </div>
  );
}

export function TradeForm({
  accounts,
  instruments,
  sessions,
  tags,
  tagCategories,
  fields,
  values,
  backtestSessionId,
  progi,
}: {
  accounts: FormAccount[];
  instruments: FormInstrument[];
  sessions: FormSession[];
  tags: TagWithCategory[];
  tagCategories: { id: number; name: string }[];
  fields: FieldDef[];
  values: TradeFormValues;
  backtestSessionId?: number | null;
  /** Progi BE z ustawien - liczone przez serwerowego rodzica (ADR-011). */
  progi: Progi;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveTrade, { ok: false });
  const [stay, setStay] = useState(false);

  const [accountId, setAccountId] = useState(values.accountId ?? accounts[0]?.id ?? 0);
  const [instrumentId, setInstrumentId] = useState(
    values.instrumentId ?? instruments[0]?.id ?? 0,
  );
  const [direction, setDirection] = useState<Direction>(values.direction ?? "long");

  const [entryPrice, setEntryPrice] = useState(values.entryPrice ?? "");
  const [contracts, setContracts] = useState(values.contracts ?? "1");
  const [stopLoss, setStopLoss] = useState(values.stopLoss ?? "");
  const [netTarget, setNetTarget] = useState(values.brokerAmount ?? "");
  const [showExtras, setShowExtras] = useState(Boolean(values.mae || values.mfe));
  /* Status jest tu stanem, a nie samym `defaultValue`, bo od niego zalezy, czy
     w ogole pokazac blok kierunku (ADR-018) - pytanie "czy mialem racje mimo
     straty" nie ma sensu przy trade'cie planowanym ani otwartym. */
  const [status, setStatus] = useState(values.status ?? "closed");

  const account = accounts.find((k) => k.id === accountId) ?? accounts[0];
  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const currency = account?.currency ?? "USD";
  const podpisStrefy = instrument
    ? `Czas giełdy — ${nazwaStrefy(instrument.exchangeTimezone)}`
    : undefined;

  /* Czyta liczbe dokladnie tak jak `number` w akcji zapisu (actions/trades.ts):
     przecinek dziesietny i spacje w tysiacach. Inaczej formularz bylby ostrzejszy
     od zapisu i odrzucalby kwoty, ktore serwer przyjmuje bez mrugniecia. */
  const parse = (w: string): number | null => {
    if (w.trim() === "") return null;
    const n = Number(w.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const spec = useMemo(() => {
    if (!instrument) return null;
    return {
      tickSize: Number(instrument.tickSize),
      tickValue: Number(instrument.tickValue),
      rthFrom: instrument.rthFrom,
      rthTo: instrument.rthTo,
      exchangeTimezone: instrument.exchangeTimezone,
    };
  }, [instrument]);

  /* Kwota z brokera w centach - dla CALEGO trade'a, bije wszystko (ADR-016).
     Ta sama zamiana co w akcji zapisu (actions/trades.ts) - inaczej podglad
     klamalby wobec bazy. Osobna sprawa od kwoty per-kawalek nizej. */
  const brokerCents = useMemo(() => {
    const n = parse(netTarget);
    return n === null ? null : Math.round(n * 100);
  }, [netTarget]);

  /* Kawalki wyjscia (ETAP 4a - czesciowe realizacje zysku). Zastapily
     pojedyncze pola exitTime/exitPrice - repeater wzorowany na
     `new-trade-shots.tsx`. Wiersze trzymamy po stabilnym `id`, nie po
     indeksie: aktualizacje i usuniecia dopasowuja sie po referencji obiektu
     (patrz `zmienWiersz`/`usunWyjscie`) - inaczej usuniecie wiersza w srodku
     przesunieloby DOM node'y pol niekontrolowanych (czas, notatka) na inne
     wiersze i pokazalo cudza wartosc. Id generowane deterministycznie w
     inicjalizatorze stanu (te same na serwerze i kliencie), a dla nowych
     wierszy - z licznika w refie, ktory rusza sie tylko po interakcji
     uzytkownika, wiec tez nigdy nie rozjezdza sie z hydratacja. */
  const [wyjscia, setWyjscia] = useState<StanWyjscia[]>(() => poczatkoweWyjscia(values.exits));
  const licznikWyjsc = useRef(wyjscia.length);
  const [rozwinieteWyjscia, setRozwinieteWyjscia] = useState<Set<string>>(() => new Set());

  /* Przelacznik trybu prostego/czesciowego (zadanie uzytkownika, 2026-08-31):
     domyslnie formularz ma wygladac jak przed dodaniem czesciowych wyjsc -
     repeater sie chowa, w siatce zostaja dwa zwykle pola "wy-0-czas"/"wy-0-cena".
     Zaznaczony pokazuje repeater bez zadnych zmian w jego dzialaniu. Startowy
     stan liczy `poczatkoweCzesciowe`, zeby edycja skalowanego trade'a nigdy nie
     chowala danych. */
  const [czesciowe, setCzesciowe] = useState(() => poczatkoweCzesciowe(values));
  /* Komunikat "najpierw usun dodatkowe wyjscia" - pokazuje sie tylko po
     probie odznaczenia, ktora zostala zablokowana (patrz `przelaczCzesciowe`),
     i znika sam, gdy wypelnionych wierszy zrobi sie <= 1 (warunek w JSX). */
  const [pokazBlokade, setPokazBlokade] = useState(false);

  function dodajWyjscie() {
    /* Zanim dolozymy wiersz, utrwalamy cene, ktora do tej pory byla WYLICZANA
       z kwoty brokera dla calego trade'a. Ta podpowiedz dziala tylko przy
       jednym wyjsciu, wiec bez utrwalenia pole pierwszego wiersza pustoszaloby
       w chwili kliniecia "Dodaj wyjscie" - a wiersz bez ceny jest przy zapisie
       odsiewany jako pusty i kwota z rachunku przepadalaby bez slowa. */
    const zKwotyTrade = wyliczCeneZKwotyTrade();
    setWyjscia((w) => [
      ...w.map((x, i) =>
        i === 0 && x.price.trim() === "" && x.kwota.trim() === "" && zKwotyTrade
          ? { ...x, price: String(zKwotyTrade.exitPrice) }
          : x,
      ),
      {
        id: `wy-nowe-${licznikWyjsc.current++}`,
        price: "",
        contracts: "",
        kwota: "",
        time: "",
        note: "",
      },
    ]);
  }

  function usunWyjscie(wiersz: StanWyjscia) {
    // Ostatni wiersz zostaje pusty, a nie znika - formularz zawsze ma co
    // najmniej jedno miejsce na wyjscie.
    setWyjscia((w) => (w.length <= 1 ? w : w.filter((x) => x !== wiersz)));
  }

  function zmienWiersz(wiersz: StanWyjscia, patch: Partial<StanWyjscia>) {
    setWyjscia((w) => w.map((x) => (x === wiersz ? { ...x, ...patch } : x)));
  }

  function przelaczRozwiniecie(id: string) {
    setRozwinieteWyjscia((s) => {
      const kopia = new Set(s);
      if (kopia.has(id)) kopia.delete(id);
      else kopia.add(id);
      return kopia;
    });
  }

  /* Cena wyliczona z kwoty brokera TEGO kawalka - jednokierunkowe, jak dawny
     mechanizm na poziomie calego trade'a (ADR-016), teraz per wiersz. */
  /* Wiersz "niepusty" znaczy tu DOKLADNIE to samo, co w akcji zapisu: cokolwiek
     wpisano w ktorekolwiek z pieciu pol. Akcja odsiewa puste wiersze zanim
     policzy, ile ich zostalo, wiec podglad musi liczyc tak samo. Liczenie
     wierszy widocznych w DOM (`wyjscia.length`) dawalo cichy rozjazd: dolozony
     pusty wiersz gasil regule w podgladzie, a zapis i tak domykal kontrakty do
     calej pozycji i zamykal trade'a. */
  function niepustyWiersz(w: StanWyjscia): boolean {
    return (
      w.price.trim() !== "" ||
      w.contracts.trim() !== "" ||
      w.kwota.trim() !== "" ||
      w.time.trim() !== "" ||
      w.note.trim() !== ""
    );
  }

  const niepustychWierszy = wyjscia.filter(niepustyWiersz).length;
  /** Czy obowiazuje regula "puste kontrakty znacza cala pozycje" - tylko przy
   * dokladnie jednym wypelnionym wierszu. */
  const jedenWiersz = niepustychWierszy <= 1;

  /** Przelacza tryb prosty/czesciowy. Wlaczenie zawsze dziala. Wylaczenie przy
   * wiecej niz jednym WYPELNIONYM wierszu skasowaloby dane uzytkownika po
   * cichu - wiec zamiast chowac repeater, checkbox zostaje zaznaczony i obok
   * pokazuje sie komunikat (kosz przy wierszu jest juz gotowym wyjsciem z
   * sytuacji). Przy najwyzej jednym wypelnionym wierszu wylaczenie dziala
   * normalnie i przycina nadmiarowe puste wiersze do jednego. */
  function przelaczCzesciowe(chce: boolean) {
    if (chce) {
      setCzesciowe(true);
      setPokazBlokade(false);
      return;
    }
    if (niepustychWierszy > 1) {
      setPokazBlokade(true);
      return;
    }
    setPokazBlokade(false);
    setCzesciowe(false);
    setWyjscia((w) => {
      const wypelniony = w.find(niepustyWiersz);
      return [wypelniony ?? w[0] ?? poczatkoweWyjscia(undefined)[0]];
    });
  }

  /** Kontrakty tego wiersza - z uwzglednieniem reguly "jedyny wiersz z pustym
   * polem znaczy cala pozycje" (ta sama, co w akcji zapisu). */
  function kontraktyWiersza(wiersz: StanWyjscia): number | null {
    if (wiersz.contracts.trim() === "" && jedenWiersz) return parse(contracts);
    return parse(wiersz.contracts);
  }

  function wyliczCeneWiersza(wiersz: StanWyjscia): ExitForAmount | null {
    if (!spec || wiersz.kwota.trim() === "") return null;
    const entry = parse(entryPrice);
    const size = kontraktyWiersza(wiersz);
    const target = parse(wiersz.kwota);
    if (entry === null || size === null || size <= 0 || target === null) return null;
    return exitPriceForAmount({
      instrument: spec,
      direction,
      contracts: size,
      entryPrice: entry,
      target: Math.round(target * 100),
    });
  }

  /* Cena wyliczona z kwoty brokera dla CALEGO trade'a. Dziala tylko przy
     jednym wyjsciu - przy kilku nie wiadomo, ktoremu kawalkowi przypisac
     kwote. To jest dawna sciezka "znam tylko kwote z rachunku, nie cene"
     (ADR-016): bez niej trade wpisany sama kwota nie da sie zapisac, bo
     serwer wymaga ceny w kazdym wierszu. */
  function wyliczCeneZKwotyTrade(): ExitForAmount | null {
    if (!spec || netTarget.trim() === "") return null;
    const entry = parse(entryPrice);
    const size = parse(contracts);
    const target = parse(netTarget);
    if (entry === null || size === null || size <= 0 || target === null) return null;
    return exitPriceForAmount({
      instrument: spec,
      direction,
      contracts: size,
      entryPrice: entry,
      target: Math.round(target * 100),
    });
  }

  /* Cena, ktora faktycznie siedzi w polu - reczna albo wyliczona z kwoty.
     Gdy kwota jest wpisana, ale nie da sie z niej policzyc ceny (brak
     kontraktow w tym wierszu), pole zostaje puste - cichy powrot do
     ostatniej recznej ceny zapisalby liczbe, do ktorej uzytkownik nie wracal.
     Kolejnosc zrodel: kwota kawalka -> reczna cena -> kwota calego trade'a. */
  function efektywnaCenaWiersza(wiersz: StanWyjscia): string {
    if (wiersz.kwota.trim() !== "") {
      const wyliczona = wyliczCeneWiersza(wiersz);
      return wyliczona ? String(wyliczona.exitPrice) : "";
    }
    if (wiersz.price.trim() === "" && jedenWiersz) {
      const zTrade = wyliczCeneZKwotyTrade();
      if (zTrade) return String(zTrade.exitPrice);
    }
    return wiersz.price;
  }

  /** Reszta kontraktow do zamkniecia pozycji, licza po odjeciu wszystkich
   * POZOSTALYCH wierszy - skrot na wiersz. */
  function ustawReszte(wiersz: StanWyjscia) {
    const total = parse(contracts);
    if (total === null) return;
    const sumaInnych = wyjscia.reduce((sum, w) => {
      if (w === wiersz) return sum;
      const c = parse(w.contracts);
      return c !== null && c > 0 ? sum + c : sum;
    }, 0);
    const reszta = total - sumaInnych;
    const wartosc = reszta > 0 ? Math.round(reszta * 1e6) / 1e6 : 0;
    zmienWiersz(wiersz, { contracts: String(wartosc) });
  }

  /* Kawalki wyjscia gotowe dla `computeTrade`. `computeTrade` sam ich NIE
     sortuje (kontrakt `calc.ts`), a od kolejnosci zalezy, ktory kawalek jest
     "ostatni" w `scalingR` - wiec podglad musi ustawic ja DOKLADNIE tak samo
     jak akcja zapisu: po czasie rosnaco, a wiersze bez czasu na koncu, w
     kolejnosci wpisania. Inaczej panel podgladu pokazywalby inny wplyw
     skalowania niz karta trade'a po zapisie.

     Zaleznosci `useMemo` sa wypisane recznie, bo cialo wola funkcje
     zdefiniowane w komponencie (`efektywnaCenaWiersza`, `kontraktyWiersza`),
     ktorych linter nie potrafi rozlozyc na skladniki - lista pokrywa wszystko,
     co te funkcje faktycznie czytaja. */
  const previewExits = useMemo(() => {
    const strefa = spec?.exchangeTimezone ?? "UTC";
    const zebrane: { exit: ExitInput; czas: Date | null; idx: number }[] = [];
    for (const [idx, w] of wyjscia.entries()) {
      const cena = parse(efektywnaCenaWiersza(w));
      const kontrakty = kontraktyWiersza(w);
      if (cena === null || kontrakty === null || kontrakty <= 0) continue;
      const kwota = parse(w.kwota);
      const czas = w.time.trim() === "" ? null : fromLocalInput(w.time, strefa);
      zebrane.push({
        czas,
        idx,
        exit: {
          price: cena,
          contracts: kontrakty,
          time: czas,
          brokerAmount: kwota === null ? null : Math.round(kwota * 100),
        },
      });
    }
    const zCzasem = zebrane
      .filter((z) => z.czas !== null)
      .sort((a, b) => a.czas!.getTime() - b.czas!.getTime() || a.idx - b.idx);
    const bezCzasu = zebrane.filter((z) => z.czas === null);
    return [...zCzasem, ...bezCzasu].map((z) => z.exit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wyjscia, entryPrice, direction, spec, contracts, netTarget]);

  const preview = useMemo(() => {
    if (!spec) return null;
    const entry = parse(entryPrice);
    const size = parse(contracts);
    if (entry === null || size === null || size <= 0) return null;

    return computeTrade({
      instrument: spec,
      direction,
      contracts: size,
      entryPrice: entry,
      exits: previewExits,
      stopLoss: parse(stopLoss),
      takeProfit: null,
      mae: null,
      mfe: null,
      entryTime: new Date(),
      brokerAmount: brokerCents,
    });
  }, [spec, direction, entryPrice, contracts, stopLoss, brokerCents, previewExits]);

  /* Kategoria (zysk/strata/be) liczona tym samym `wynikTrade`, co statystyki -
     zeby podglad w formularzu nigdy nie klamal wobec tego, co pokaze tabela
     po zapisie (ADR-011). */
  const wynik = useMemo(() => {
    if (preview?.pnl === null || preview?.pnl === undefined) return null;
    return wynikTrade(
      { pnl: preview.pnl, riskAmount: preview.riskAmount, contracts: parse(contracts) ?? 0 },
      progi,
    );
  }, [preview, contracts, progi]);

  /** Liczba kontraktow do widoku - bez sztucznych miejsc po przecinku, gdy
   * wartosc jest calkowita. */
  const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : num(n, 2));

  /* Licznik pod repeaterem: "zrealizowane X z Y kontraktow - Z zostaje
     otwarty/otwarte" albo "cala pozycja zamknieta". Odmiana przez `plural`
     (genetiv liczby mnogiej "kontraktow" jest ten sam dla "kilku" i "wielu" -
     rozni sie tylko forma pojedyncza po "z 1"). */
  const podsumowanieWyjsc = useMemo(() => {
    const total = parse(contracts);
    if (total === null || total <= 0) return null;
    const filled = wyjscia.reduce((sum, w) => {
      const c = parse(w.contracts);
      return c !== null && c > 0 ? sum + c : sum;
    }, 0);
    const remaining = total - filled;
    if (remaining <= EPS_KONTRAKTY) return "Cała pozycja zamknięta.";
    return `Zrealizowane ${formatQty(filled)} z ${formatQty(total)} ${plural(
      Math.round(total) === 1 ? 1 : 2,
      "kontraktu",
      "kontraktów",
      "kontraktów",
    )} — ${formatQty(remaining)} ${plural(
      Math.round(remaining),
      "zostaje otwarty",
      "zostają otwarte",
      "zostają otwarte",
    )}.`;
  }, [wyjscia, contracts]);

  /** Ile kontraktow zmiesci sie w domyslnym ryzyku konta. */
  const suggestedSize = useMemo(() => {
    if (!instrument || !account?.defaultRiskAmount) return null;
    const entry = parse(entryPrice);
    const stop = parse(stopLoss);
    if (entry === null || stop === null) return null;
    const ticks = Math.abs(Math.round((entry - stop) / Number(instrument.tickSize)));
    if (ticks <= 0) return null;
    const perContract = (ticks * Number(instrument.tickValue)) / 10;
    if (perContract <= 0) return null;
    return account.defaultRiskAmount / perContract;
  }, [instrument, account, entryPrice, stopLoss]);

  const isEdit = Boolean(values.id);

  return (
    <form action={formAction} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="stay" value={stay ? "1" : "0"} />
      {backtestSessionId && (
        <input type="hidden" name="backtestSessionId" value={backtestSessionId} />
      )}

      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
      {state.ok && stay && <SuccessMessage>Zapisano. Możesz wpisywać kolejny.</SuccessMessage>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Panel title="Pozycja">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="accountId" required>
                  Konto
                </Label>
                <Select
                  id="accountId"
                  name="accountId"
                  value={accountId}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                >
                  {accounts.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="instrumentId" required>
                  Instrument
                </Label>
                <Select
                  id="instrumentId"
                  name="instrumentId"
                  value={instrumentId}
                  onChange={(e) => setInstrumentId(Number(e.target.value))}
                >
                  {instruments.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.symbol} — {i.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Kierunek</Label>
                <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
                  {(["long", "short"] as const).map((d) => (
                    <label key={d} className="flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name="direction"
                        value={d}
                        checked={direction === d}
                        onChange={() => setDirection(d)}
                        className="peer sr-only"
                      />
                      <span
                        className={cx(
                          "flex h-9 items-center justify-center text-sm transition-colors duration-150",
                          direction === d
                            ? d === "long"
                              ? "bg-profit-dim font-medium text-profit"
                              : "bg-loss-dim font-medium text-loss"
                            : "bg-surface-2 text-muted hover:text-text",
                        )}
                      >
                        {d === "long" ? "Long" : "Short"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contracts" required>
                  Kontrakty
                </Label>
                <Input
                  id="contracts"
                  name="contracts"
                  inputMode="decimal"
                  value={contracts}
                  onChange={(e) => setContracts(e.target.value)}
                  required
                />
                {suggestedSize !== null && (
                  <p className="text-xs text-faint">
                    Przy ryzyku {money(account?.defaultRiskAmount ?? 0, { currency })}:{" "}
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => setContracts(String(Math.floor(suggestedSize) || 1))}
                    >
                      {num(suggestedSize, 2)} kontraktu
                    </button>
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Wejście i wyjście">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Godziny sa w czasie GIELDY instrumentu, nie w strefie
                  uzytkownika (ADR-022, 2026-08-30). Napis przy etykiecie nie
                  jest ozdoba: bez niego nie da sie odroznic 09:35 z wykresu
                  nowojorskiego od 09:35 na zegarku, a to szesc godzin roznicy
                  i inna sesja rynkowa. */}
              <div className="space-y-1.5">
                <Label htmlFor="entryTime" required hint={podpisStrefy}>
                  Wejście — data i godzina
                </Label>
                <Input
                  id="entryTime"
                  name="entryTime"
                  type="datetime-local"
                  defaultValue={values.entryTime ?? ""}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="entryPrice" required>
                  Cena wejścia
                </Label>
                <Input
                  id="entryPrice"
                  name="entryPrice"
                  inputMode="decimal"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  required
                />
              </div>
              {/* Tryb prosty (checkbox "Czesciowe wyjscia" ponizej odznaczony):
                  zamiast obramowanego repeatera - dwa zwykle pola w tej samej
                  siatce, jak przed dodaniem czesciowych wyjsc. Zawsze mapuja
                  sie na wiersz 0 (`wyjscia[0]`), ktory w tym trybie jest
                  jedynym wierszem. Pozostale trzy pola wiersza (kontrakty,
                  kwota, notatka) i tak musza trafic do FormData jako puste -
                  akcja zapisu paruje wiersze po indeksie i liczy Math.max po
                  pieciu tablicach; puste kontrakty przy jednym wierszu znacza
                  "cala pozycja", dokladnie to, co ma sie dziac tutaj. */}
              {!czesciowe && wyjscia[0] && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="wy-0-czas" hint={podpisStrefy}>
                      Wyjście — data i godzina
                    </Label>
                    <Input
                      id="wy-0-czas"
                      name="wy_czas"
                      type="datetime-local"
                      value={wyjscia[0].time}
                      onChange={(e) => zmienWiersz(wyjscia[0], { time: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wy-0-cena">Cena wyjścia</Label>
                    <Input
                      id="wy-0-cena"
                      name="wy_cena"
                      inputMode="decimal"
                      value={efektywnaCenaWiersza(wyjscia[0])}
                      onChange={(e) =>
                        // Reczna edycja ceny zawsze wygrywa - gasi wyliczenie z kwoty.
                        zmienWiersz(wyjscia[0], { price: e.target.value, kwota: "" })
                      }
                    />
                  </div>
                  <input type="hidden" name="wy_kontrakty" value={wyjscia[0].contracts} />
                  <input type="hidden" name="wy_kwota" value={wyjscia[0].kwota} />
                  <input type="hidden" name="wy_notatka" value={wyjscia[0].note} />
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="stopLoss" hint="Bez stopa nie policzymy R">
                  Stop loss
                </Label>
                <Input
                  id="stopLoss"
                  name="stopLoss"
                  inputMode="decimal"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="takeProfit">Take profit</Label>
                <Input
                  id="takeProfit"
                  name="takeProfit"
                  inputMode="decimal"
                  defaultValue={values.takeProfit ?? ""}
                />
              </div>
              {/* Kwota z rachunku brokera dla CALEGO trade'a - bije wszystko,
                  i ceny kawalkow, i ich kwoty (ADR-016). Osobna sprawa od
                  kwoty per-kawalek w repeaterze wyjsc nizej. */}
              <div className="space-y-1.5">
                <Label htmlFor="brokerAmount" hint="Nadpisuje wynik całego trade'a">
                  Kwota z brokera ({currency})
                </Label>
                <Input
                  id="brokerAmount"
                  name="brokerAmount"
                  inputMode="decimal"
                  placeholder="suma z rachunku"
                  value={netTarget}
                  onChange={(e) => setNetTarget(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  name="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="closed">zamknięty</option>
                  <option value="open">otwarty</option>
                  <option value="planned">planowany</option>
                  <option value="cancelled">anulowany</option>
                  <option value="missed">nie wzięty</option>
                </Select>
                {status === "missed" && (
                  <p className="text-xs text-faint">
                    Setup był, ale go nie wziąłeś — wynik hipotetyczny się liczy, ale trade nie
                    liczy się do statystyk.
                  </p>
                )}
              </div>
            </div>

            {/* Przelacznik trybu prostego/czesciowego + repeater czesciowych
                wyjsc (ETAP 4a, ukryty w trybie prostym na prosbe uzytkownika
                2026-08-31 - patrz `przelaczCzesciowe`). Domyslnie tryb prosty:
                repeater znika, jeden wiersz zyje w dwoch zwyklych polach
                siatki wyzej. */}
            <div className="space-y-2.5 border-t border-line px-4 py-3">
              <div className="space-y-1">
                <Checkbox
                  id="czesciowe-wyjscia"
                  label="Częściowe wyjścia"
                  hint="Zamykałem pozycję po kawałku — TP1, TP2, runner"
                  checked={czesciowe}
                  onChange={(e) => przelaczCzesciowe(e.target.checked)}
                />
                {pokazBlokade && niepustychWierszy > 1 && (
                  <p className="text-xs text-loss" role="alert">
                    Najpierw usuń dodatkowe wyjścia.
                  </p>
                )}
              </div>

              {czesciowe && (
              <>
              <Label hint="Puste = pozycja wciąż otwarta">Wyjścia</Label>
              <div className="space-y-2">
                {wyjscia.map((w, i) => {
                  const rozwiniety = rozwinieteWyjscia.has(w.id);
                  return (
                    <fieldset
                      key={w.id}
                      className="space-y-2 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 p-2.5"
                    >
                      <legend className="sr-only">Wyjście {i + 1}</legend>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[9.5rem] flex-1 space-y-1">
                          <Label htmlFor={`wy-${i}-czas`} hint={i === 0 ? podpisStrefy : undefined}>
                            Czas
                          </Label>
                          <Input
                            id={`wy-${i}-czas`}
                            name="wy_czas"
                            type="datetime-local"
                            value={w.time}
                            onChange={(e) => zmienWiersz(w, { time: e.target.value })}
                          />
                        </div>
                        <div className="min-w-[6.5rem] flex-1 space-y-1">
                          <Label htmlFor={`wy-${i}-cena`}>Cena</Label>
                          <Input
                            id={`wy-${i}-cena`}
                            name="wy_cena"
                            inputMode="decimal"
                            value={efektywnaCenaWiersza(w)}
                            onChange={(e) =>
                              // Reczna edycja ceny zawsze wygrywa - gasi wyliczenie z kwoty.
                              zmienWiersz(w, { price: e.target.value, kwota: "" })
                            }
                          />
                        </div>
                        <div className="min-w-[6rem] flex-1 space-y-1">
                          <Label htmlFor={`wy-${i}-kontrakty`}>Kontrakty</Label>
                          <Input
                            id={`wy-${i}-kontrakty`}
                            name="wy_kontrakty"
                            inputMode="decimal"
                            value={w.contracts}
                            /* Przy jednym wyjsciu puste pole znaczy "cala pozycja" -
                               podpowiedz pokazuje ta liczbe, zeby regula nie dzialala
                               po cichu. Przy kilku wierszach nie ma czego domyslac. */
                            placeholder={
                              jedenWiersz && contracts.trim() !== ""
                                ? `${contracts} (cała pozycja)`
                                : undefined
                            }
                            onChange={(e) => zmienWiersz(w, { contracts: e.target.value })}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pb-1.5">
                          <button
                            type="button"
                            onClick={() => ustawReszte(w)}
                            className="text-xs text-accent hover:underline"
                          >
                            reszta
                          </button>
                          <button
                            type="button"
                            onClick={() => przelaczRozwiniecie(w.id)}
                            aria-expanded={rozwiniety}
                            className="text-xs text-muted hover:text-text hover:underline"
                          >
                            {rozwiniety ? "ukryj szczegóły" : "kwota i notatka"}
                          </button>
                          <button
                            type="button"
                            onClick={() => usunWyjscie(w)}
                            disabled={wyjscia.length <= 1}
                            aria-label={`Usuń wyjście ${i + 1}`}
                            className="rounded-[var(--radius-control)] border border-line-strong p-1.5 text-faint transition-colors duration-150 hover:text-loss disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        </div>
                      </div>

                      {/* `hidden` (nie warunkowe odmontowanie) - pola musza
                          zostac w DOM nawet zwiniete, akcja zapisu paruje
                          wiersze po indeksie i oczekuje wszystkich pieciu pol
                          z kazdego wiersza, takze pustych. */}
                      <div hidden={!rozwiniety} className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label
                            htmlFor={`wy-${i}-kwota`}
                            hint="Nadpisuje cenę tego kawałka"
                          >
                            Kwota z brokera ({currency})
                          </Label>
                          <Input
                            id={`wy-${i}-kwota`}
                            name="wy_kwota"
                            inputMode="decimal"
                            value={w.kwota}
                            onChange={(e) => zmienWiersz(w, { kwota: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`wy-${i}-notatka`}>Notatka</Label>
                          <Input
                            id={`wy-${i}-notatka`}
                            name="wy_notatka"
                            value={w.note}
                            onChange={(e) => zmienWiersz(w, { note: e.target.value })}
                          />
                        </div>
                      </div>
                    </fieldset>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" size="s" onClick={dodajWyjscie}>
                  <Plus size={14} aria-hidden />
                  Dodaj wyjście
                </Button>
                {podsumowanieWyjsc && (
                  <p className="text-xs text-faint" aria-live="polite">
                    {podsumowanieWyjsc}
                  </p>
                )}
              </div>
              </>
              )}
            </div>

            <div className="border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setShowExtras((w) => !w)}
                className="text-xs text-accent hover:underline"
              >
                {showExtras ? "Ukryj MAE i MFE" : "Dodaj MAE i MFE (maksymalne obsunięcie i zasięg)"}
              </button>
              {showExtras && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mae" hint="Najgorsza cena w trakcie trwania pozycji">
                      MAE — cena
                    </Label>
                    <Input id="mae" name="mae" inputMode="decimal" defaultValue={values.mae ?? ""} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mfe" hint="Najlepsza cena w trakcie trwania pozycji">
                      MFE — cena
                    </Label>
                    <Input id="mfe" name="mfe" inputMode="decimal" defaultValue={values.mfe ?? ""} />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Kontekst">
            <div className="space-y-4 p-4">
              {/* Strategia i checklista strategii zniknely stad 2026-08-29 na
                  prosbe uzytkownika - typ zagrania opisuje teraz kategoria
                  tagow "Styl wejścia". Kolumny `strategy_id` i `rules_met`
                  zostaly w bazie, zeby historia sie nie zgubila; strategie
                  nadal opisuja sesje backtestu. */}
              {!backtestSessionId && sessions.length > 0 && (
                <div className="space-y-1.5 sm:max-w-sm">
                  <Label htmlFor="backtestSessionId" hint="Zostaw puste dla realnego trade'a">
                    Sesja backtestu
                  </Label>
                  <Select
                    id="backtestSessionId"
                    name="backtestSessionId"
                    defaultValue={values.backtestSessionId ?? 0}
                  >
                    <option value={0}>— dziennik realny —</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div>
                <Label>Tagi</Label>
                <div className="mt-1.5 space-y-3">
                  {/* PULAPKA (ADR-013): TagPicker nie moze dostac `key` liczonego
                      z listy tagow (np. tags.length albo JSON.stringify(tags)).
                      Zapis w TagManager ponizej robi revalidatePath, wiec `tags`
                      tutaj odswieza sie samo z serwera bez przeladowania strony -
                      ale gdyby TagPicker mial klucz zalezny od tej listy, kazda
                      zmiana tagu remontowalaby cale poddrzewo i kasowala zarowno
                      zaznaczenia tagow, jak i wpisane juz pola reszty formularza. */}
                  <TagPicker tags={tags} selected={values.tags ?? []} />
                  <TagManager tags={tags} categories={tagCategories} />
                </div>
              </div>

              <Gotowosc moodNote={values.moodNote} readiness={values.readiness} />

              <FieldInputs
                fields={fields}
                values={values.custom ?? {}}
                errors={state.fieldErrors}
              />

              <BlokKierunku
                widoczny={status === "closed" && wynik !== null && wynik !== "zysk"}
                wygrana={status === "closed" && wynik === "zysk"}
                values={values}
                podpowiedzR={preview?.mfeR ?? null}
              />

              <div className="space-y-1.5">
                <Label htmlFor="note">Notatka</Label>
                <Textarea
                  id="note"
                  name="note"
                  rows={4}
                  defaultValue={values.note ?? ""}
                  placeholder="Co widziałeś, dlaczego wszedłeś, co poszło inaczej niż w planie."
                />
              </div>
            </div>
          </Panel>

          <Panel
            title="Zrzuty wykresu"
            description={`PNG, JPEG, WEBP lub AVIF, do 10 MB. Maksymalnie ${MAX_ZRZUTOW}.`}
          >
            {/* Nowy trade nie ma jeszcze id, wiec pliki jada z formularzem.
                W edycji zrzuty leca od razu, obok reszty pol. */}
            {values.id ? (
              <ScreenshotUploader
                cel={{ typ: "trade", tradeId: values.id }}
                shots={values.shots ?? []}
                opis="ten trade"
              />
            ) : (
              <NewTradeShots />
            )}
          </Panel>

          <SubmitRow isEdit={isEdit} onStay={setStay} />
        </div>

        {/* Podglad wyniku liczony na zywo */}
        <div className="xl:sticky xl:top-6 xl:h-fit">
          <Panel title="Podgląd wyniku" description="Liczone tym samym kodem co zapis">
            <div className="grid grid-cols-2 gap-3 p-4">
              <DataPoint label="Ticki">{preview?.ticks ?? "—"}</DataPoint>
              <DataPoint label="Ticki ryzyka">{preview?.riskTicks ?? "—"}</DataPoint>
              <DataPoint
                label="Wynik"
                valueClassName={
                  (preview?.pnl ?? 0) > 0
                    ? "text-profit"
                    : (preview?.pnl ?? 0) < 0
                      ? "text-loss"
                      : undefined
                }
              >
                {money(preview?.pnl ?? null, { currency, sign: true })}
              </DataPoint>
              <DataPoint label="Ryzyko">{money(preview?.riskAmount ?? null, { currency })}</DataPoint>
              <DataPoint
                label="Wynik w R"
                valueClassName={
                  (preview?.rMultiple ?? 0) > 0
                    ? "text-profit"
                    : (preview?.rMultiple ?? 0) < 0
                      ? "text-loss"
                      : undefined
                }
              >
                {rValue(preview?.rMultiple ?? null)}
              </DataPoint>
              {wynik && (
                <DataPoint label="Kategoria" valueClassName={wynikClass(wynik)}>
                  {WYNIK_NAZWY[wynik]}
                </DataPoint>
              )}
              {/* Srednia cena ma sens do pokazania dopiero przy wiecej niz
                  jednym wyjsciu - przy jednym byloby to po prostu ta sama
                  cena co w wierszu, zbedny szum. */}
              {preview && preview.exitCount > 1 && (
                <DataPoint label="Średnia cena wyjścia">
                  {price(preview.exitPrice, instrument?.tickSize)}
                </DataPoint>
              )}
              {preview && preview.exitCount > 0 && (
                <DataPoint label="Zrealizowana pozycja">
                  {formatQty(preview.closedContracts)} / {formatQty(parse(contracts) ?? 0)}
                </DataPoint>
              )}
              {preview?.scalingR !== null && preview?.scalingR !== undefined && (
                <DataPoint
                  label="Wpływ skalowania"
                  valueClassName={
                    preview.scalingR > 0
                      ? "text-profit"
                      : preview.scalingR < 0
                        ? "text-loss"
                        : undefined
                  }
                >
                  {rValue(preview.scalingR)}
                </DataPoint>
              )}
            </div>
            {instrument && (
              <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
                {instrument.symbol}: tick {price(instrument.tickSize, instrument.tickSize)} ={" "}
                {money(Math.round(Number(instrument.tickValue) / 10), { currency })} na kontrakt.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </form>
  );
}

/**
 * Kierunek trafiony mimo zlej egzekucji (ADR-018).
 *
 * Blok pokazuje sie WYLACZNIE przy zamknietym trade'cie, ktory nie jest
 * zyskiem - przy wygranej pytanie nie ma sensu, bo trafnosc wynika z wyniku.
 *
 * Ukryte pole `kierunek_oceniany` jest tu istotne: bez niego serwer nie
 * odroznilby "kierunek chybiony" (blok widoczny, checkbox odznaczony) od
 * "nie pytalismy" (blok w ogole sie nie renderowal). Gdyby jedno i drugie
 * zapisywalo `null`, mianownik trafnosci rownalby sie licznikowi i metryka
 * zawsze pokazywalaby sto procent.
 */
function BlokKierunku({
  widoczny,
  wygrana,
  values,
  podpowiedzR,
}: {
  widoczny: boolean;
  wygrana: boolean;
  values: TradeFormValues;
  podpowiedzR: number | null;
}) {
  if (wygrana) {
    return (
      <p className="text-xs text-faint">
        Kierunek trafiony — wynika z wyniku, nie trzeba tego zaznaczać.
      </p>
    );
  }
  if (!widoczny) return null;

  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
      <input type="hidden" name="kierunek_oceniany" value="1" />
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          name="directionCorrect"
          value="1"
          defaultChecked={values.directionCorrect === true}
          className="peer h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-sm text-text">Kierunek był dobry, zawiodła egzekucja</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="badExecutionReason">Powód</Label>
          <Select
            id="badExecutionReason"
            name="badExecutionReason"
            defaultValue={values.badExecutionReason ?? ""}
          >
            <option value="">— nie wskazuję —</option>
            {POWODY.map((w) => (
              <option key={w} value={w}>
                {POWOD_NAZWY[w]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="potentialR">Cena doszła do (R)</Label>
          <Input
            id="potentialR"
            name="potentialR"
            inputMode="decimal"
            defaultValue={values.potentialR ?? ""}
            placeholder={podpowiedzR === null ? "np. 2.5" : `MFE: ${podpowiedzR.toFixed(2)}`}
          />
          <p className="text-xs text-faint">
            Zasięg całego ruchu, także po Twoim wyjściu — to nie to samo co MFE.
          </p>
        </div>
      </div>
    </div>
  );
}
