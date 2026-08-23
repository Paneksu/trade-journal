"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { ScreenshotUploader } from "@/components/screenshots/screenshot-uploader";
import type { Shot } from "@/components/screenshots/typy";
import { FieldInputs } from "./field-inputs";
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
import { wynikTrade, type Progi } from "@/lib/domain/outcome";
import type { FieldDef } from "@/lib/fields/fields";
import { money, num, price, rValue, wynikClass, WYNIK_NAZWY } from "@/lib/format";
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
export type FormStrategy = { id: number; name: string; rules: { id: string; text: string }[] };
export type FormSession = { id: number; name: string };

export type TradeFormValues = {
  id?: number;
  accountId?: number | null;
  instrumentId?: number | null;
  strategyId?: number | null;
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
  mae?: string;
  mfe?: string;
  note?: string;
  executionRating?: number | null;
  rulesMet?: string[];
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
  strategies,
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
  strategies: FormStrategy[];
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
  const [strategyId, setStrategyId] = useState(values.strategyId ?? 0);
  const [direction, setDirection] = useState<Direction>(values.direction ?? "long");

  const [entryPrice, setEntryPrice] = useState(values.entryPrice ?? "");
  const [exitPrice, setExitPrice] = useState(values.exitPrice ?? "");
  const [contracts, setContracts] = useState(values.contracts ?? "1");
  const [stopLoss, setStopLoss] = useState(values.stopLoss ?? "");
  const [netTarget, setNetTarget] = useState("");
  const [showExtras, setShowExtras] = useState(Boolean(values.mae || values.mfe));

  const account = accounts.find((k) => k.id === accountId) ?? accounts[0];
  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const strategy = strategies.find((s) => s.id === strategyId);
  const currency = account?.currency ?? "USD";

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

  /* Cena wyjscia wyliczona z wpisanego wyniku. Jednokierunkowe: liczy sie
     tylko z netTarget w dol do exitPrice, nigdy odwrotnie - inaczej byloby kolo. */
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
    });
  }, [spec, direction, entryPrice, effectiveExit, contracts, stopLoss]);

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
     dlaczego cena sie nie policzyla albo o ile odbiega od wpisanej kwoty.
     Powod nazywamy po imieniu: inaczej przy zlej kwocie dostaje instrukcje
     dotyczaca pol, ktorych nie tknal. */
  const netTargetMessage = useMemo(() => {
    if (netTarget.trim() === "") return null;
    if (parse(netTarget) === null) return "Nie umiem odczytać tej kwoty.";
    if (!derivedExit) return "Podaj cenę wejścia i liczbę kontraktów.";
    if (derivedExit.diff === 0) return null;
    const kierunek = derivedExit.diff > 0 ? "więcej" : "mniej";
    // Cena z przecinkiem dziesietnym, ale bez `price` - to obcieloby miejsca
    // po przecinku, gdy cena wejscia jest dokladniejsza niz tick instrumentu.
    const cena = String(derivedExit.exitPrice).replace(".", ",");
    return `Cena na siatce ticków to ${cena}, co daje wynik ${money(derivedExit.pnl, {
      currency,
    })}, czyli o ${money(Math.abs(derivedExit.diff), { currency })} ${kierunek} niż wpisane.`;
  }, [netTarget, derivedExit, currency]);

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
              <div className="space-y-1.5">
                <Label htmlFor="entryTime" required>
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
                <Label htmlFor="exitTime">Wyjście — data i godzina</Label>
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
              {/* Pole bez atrybutu name - do zapisu idzie tylko wyliczona cena wyjscia.
                  Stoi pod cena wyjscia, bo z niej korzysta. */}
              <div className="space-y-1.5">
                <Label htmlFor="netTarget" hint="Wynik trade'a">
                  Kwota z brokera ({currency})
                </Label>
                <Input
                  id="netTarget"
                  inputMode="decimal"
                  placeholder="policzy cenę wyjścia"
                  value={netTarget}
                  onChange={(e) => setNetTarget(e.target.value)}
                  aria-describedby={netTargetMessage ? "netTarget-hint" : undefined}
                />
                {netTargetMessage && (
                  <p id="netTarget-hint" className="text-xs text-faint">
                    {netTargetMessage}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue={values.status ?? "closed"}>
                  <option value="closed">zamknięty</option>
                  <option value="open">otwarty</option>
                  <option value="planned">planowany</option>
                  <option value="cancelled">anulowany</option>
                </Select>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="strategyId">Strategia</Label>
                  <Select
                    id="strategyId"
                    name="strategyId"
                    value={strategyId}
                    onChange={(e) => setStrategyId(Number(e.target.value))}
                  >
                    <option value={0}>— bez strategii —</option>
                    {strategies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {!backtestSessionId && sessions.length > 0 && (
                  <div className="space-y-1.5">
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
              </div>

              {strategy && strategy.rules.length > 0 && (
                <div>
                  <Label>Checklista strategii</Label>
                  <ul className="mt-1.5 space-y-1.5">
                    {strategy.rules.map((r) => (
                      <li key={r.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-muted hover:text-text">
                          <input
                            type="checkbox"
                            name="rule"
                            value={r.id}
                            defaultChecked={values.rulesMet?.includes(r.id)}
                            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                          />
                          {r.text}
                        </label>
                      </li>
                    ))}
                  </ul>
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

              <FieldInputs
                fields={fields}
                values={values.custom ?? {}}
                errors={state.fieldErrors}
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

              <div className="space-y-1.5">
                <Label htmlFor="executionRating">Ocena wykonania</Label>
                <Select
                  id="executionRating"
                  name="executionRating"
                  defaultValue={values.executionRating ?? ""}
                >
                  <option value="">— nie oceniam —</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}/5
                    </option>
                  ))}
                </Select>
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
