"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import type { Shot } from "@/components/screenshots/typy";
import { FieldInputs } from "./field-inputs";
import { Gotowosc } from "./gotowosc";
import { NewTradeShots } from "./new-trade-shots";
import { TagManager } from "./tag-manager";
import { TagPicker } from "./tag-picker";
import {
  Button,
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
import { computeTrade, exitPriceForAmount, type Direction } from "@/lib/domain/calc";
import { POWODY, POWOD_NAZWY } from "@/lib/domain/kierunek";
import { wynikTrade, type Progi } from "@/lib/domain/outcome";
import type { FieldDef } from "@/lib/fields/fields";
import { money, nazwaStrefy, num, price, rValue, wynikClass, WYNIK_NAZWY } from "@/lib/format";
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

export type TradeFormValues = {
  id?: number;
  accountId?: number | null;
  instrumentId?: number | null;
  backtestSessionId?: number | null;
  direction?: Direction;
  status?: string;
  entryTime?: string;
  entryPrice?: string;
  exitTime?: string;
  exitPrice?: string;
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
  const [exitPrice, setExitPrice] = useState(values.exitPrice ?? "");
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

  /* Kwota z brokera w centach. Ta sama zamiana co w akcji zapisu
     (actions/trades.ts) - inaczej podglad klamalby wobec bazy. */
  const brokerCents = useMemo(() => {
    const n = parse(netTarget);
    return n === null ? null : Math.round(n * 100);
  }, [netTarget]);

  /* Cena wyjscia wyliczona z wpisanej kwoty. Jednokierunkowe: liczy sie
     tylko z kwoty w dol do exitPrice, nigdy odwrotnie - inaczej byloby kolo.
     Kwota zostaje wynikiem trade'a (ADR-016), cena jest tylko jej odwzorowaniem
     na siatce tickow. */
  const derivedExit = useMemo(() => {
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
  }, [netTarget, entryPrice, contracts, direction, spec]);

  /* Do pola ceny wchodzi surowa liczba, nie wersja sformatowana lokalnie.
     Formatowanie przycielo by miejsca po przecinku, gdy cena wejscia jest
     dokladniejsza niz tick, a spacja nierozdzielajaca nie ma czego szukac w polu. */
  const exitText = derivedExit ? String(derivedExit.exitPrice) : null;

  /* Podglad liczy sie z ceny, ktora naprawde siedzi w polu - wiec takze z tej
     wyliczonej z kwoty netto. Inaczej panel obok milczalby przy wpisanej kwocie.
     Gdy kwota jest wpisana, ale nie da sie z niej policzyc ceny, pole musi zostac
     puste: cichy powrot do ostatniej recznej ceny zapisalby liczbe, do ktorej
     uzytkownik nie wracal, i to wbrew komunikatowi pod polem kwoty. */
  const effectiveExit = netTarget.trim() === "" ? exitPrice : (exitText ?? "");

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
      exitPrice: parse(effectiveExit),
      stopLoss: parse(stopLoss),
      takeProfit: null,
      mae: null,
      mfe: null,
      entryTime: new Date(),
      exitTime: parse(effectiveExit) === null ? null : new Date(),
      brokerAmount: brokerCents,
    });
  }, [spec, direction, entryPrice, effectiveExit, contracts, stopLoss, brokerCents]);

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

  /* Komunikat pod polem kwoty - cisza nie jest opcja, uzytkownik ma wiedziec,
     dlaczego cena sie nie policzyla albo jaka cena wejdzie do zapisu. Powod
     nazywamy po imieniu: inaczej przy zlej kwocie dostaje instrukcje dotyczaca
     pol, ktorych nie tknal. O roznicy wobec siatki tickow juz nie mowimy -
     od ADR-016 to kwota jest wynikiem, a cena tylko jej przyblizeniem. */
  const netTargetMessage = useMemo(() => {
    if (netTarget.trim() === "") return null;
    if (brokerCents === null) return "Nie umiem odczytać tej kwoty.";
    if (!derivedExit) return "Podaj cenę wejścia i liczbę kontraktów.";
    // Cena z przecinkiem dziesietnym, ale bez `price` - to obcieloby miejsca
    // po przecinku, gdy cena wejscia jest dokladniejsza niz tick instrumentu.
    const cena = String(derivedExit.exitPrice).replace(".", ",");
    return `Cena wyjścia na siatce ticków: ${cena}. W wyniku i statystykach liczy się wpisane ${money(
      brokerCents,
      { currency },
    )}.`;
  }, [netTarget, brokerCents, derivedExit, currency]);

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
              <div className="space-y-1.5">
                <Label htmlFor="exitTime" hint={podpisStrefy}>
                  Wyjście — data i godzina
                </Label>
                <Input
                  id="exitTime"
                  name="exitTime"
                  type="datetime-local"
                  defaultValue={values.exitTime ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exitPrice" hint="Puste = pozycja wciąż otwarta">
                  Cena wyjścia
                </Label>
                <Input
                  id="exitPrice"
                  name="exitPrice"
                  inputMode="decimal"
                  value={effectiveExit}
                  onChange={(e) => {
                    // Reczna edycja ceny zawsze wygrywa - gasi wyliczenie z kwoty netto.
                    setExitPrice(e.target.value);
                    setNetTarget("");
                  }}
                />
              </div>

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
              {/* Kwota z rachunku brokera idzie do zapisu i to ona jest wynikiem
                  trade'a (ADR-016). Cena wyjscia liczy sie z niej, nie odwrotnie,
                  wiec pole stoi tuz pod cena. */}
              <div className="space-y-1.5">
                <Label htmlFor="brokerAmount" hint="Ta kwota jest wynikiem">
                  Kwota z brokera ({currency})
                </Label>
                <Input
                  id="brokerAmount"
                  name="brokerAmount"
                  inputMode="decimal"
                  placeholder="policzy cenę wyjścia"
                  value={netTarget}
                  onChange={(e) => setNetTarget(e.target.value)}
                  aria-describedby={netTargetMessage ? "brokerAmount-hint" : undefined}
                />
                {netTargetMessage && (
                  <p id="brokerAmount-hint" className="text-xs text-faint">
                    {netTargetMessage}
                  </p>
                )}
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
