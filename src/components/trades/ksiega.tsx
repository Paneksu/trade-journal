"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, Lock, PanelRightOpen, Trash2, X } from "lucide-react";

import { EmptyState } from "@/components/ui/base";
import { ChipProcesu } from "@/components/ui/v2";
import { cx } from "@/lib/classes";
import { deleteMany, tagMany } from "@/lib/actions/trades";
import { podgladTradu, type PodgladTradu } from "@/lib/actions/podglad";
import { maWynik } from "@/lib/domain/status";
import { TRADE_STATUS_NAMES } from "@/lib/domain/types";
import type { StatusTrade } from "@/lib/domain/status";
import { longDate, money, pnlClass, price, rValue, timeOnly } from "@/lib/format";
import type { TagWithCategory } from "@/lib/queries/dictionaries";
import { ObrazZrzutu } from "@/components/screenshots/obraz-zrzutu";

/**
 * Lista trade'ów jako księga (wzór 2a: lista Linear + księga Mercury z demo.mercury.com/accounts/credit):
 * wiersz 48 px, grupy po dniu z datą tylko w pierwszym wierszu dnia, kolumny godzina, trade, setup (chip),
 * proces A/B/C, wynik i R wyrównane do prawej w Plex Mono. Klik w wiersz otwiera prawą szufladę podglądu
 * (wzór 2b) bez zmiany strony; link w kolumnie „Trade” prowadzi do karty.
 */

export type WierszKsiegi = {
  id: number;
  dzien: string;
  wejscie: string;
  strefa: string;
  symbol: string;
  kierunek: string;
  kontrakty: number;
  status: StatusTrade;
  pnl: number;
  r: number | null;
  waluta: string;
  setup: string | null;
  proces: "A" | "B" | "C" | null;
  ukryty: boolean;
  zrzuty: number;
  wynik: "zysk" | "strata" | "be";
};

function Szuflada({ id, onClose }: { id: number; onClose: () => void }) {
  const [dane, setDane] = useState<PodgladTradu | null | undefined>(undefined);
  const zamknij = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let aktualne = true;
    podgladTradu(id).then((d) => {
      if (aktualne) setDane(d);
    });
    return () => {
      aktualne = false;
    };
  }, [id]);

  useEffect(() => {
    zamknij.current?.focus();
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`Podgląd trade'a #${id}`}
      className="fixed top-0 right-0 bottom-0 z-[var(--z-nakladka)] karta flex w-full max-w-[420px] flex-col rounded-none border-l border-line-strong shadow-[var(--shadow-pop)] sm:top-14 sm:bottom-auto sm:max-h-[calc(100vh-56px)] sm:rounded-bl-[var(--radius-panel)]"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <p className="text-karta text-muted">
          {dane ? (
            <>
              <span className="num text-text">{dane.symbol}</span> {dane.direction} · <span className="num">#{dane.id}</span>
            </>
          ) : (
            <span className="num">#{id}</span>
          )}
        </p>
        <button
          ref={zamknij}
          type="button"
          onClick={onClose}
          aria-label="Zamknij podgląd"
          className="przejscie flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {dane === undefined && <p className="text-meta text-faint">Wczytuję…</p>}
        {dane === null && <p className="text-meta text-faint">Nie ma takiego trade&apos;a.</p>}
        {dane && (
          <div className="space-y-6">
            <div>
              {dane.resultHidden ? (
                <p className="flex items-center gap-2 text-karta text-muted">
                  <Lock size={16} className="text-accent" aria-hidden /> Wynik ukryty do zamknięcia (werdykt AI przed wynikiem)
                </p>
              ) : (
                <p className={cx("num text-liczba font-medium", maWynik(dane.status as StatusTrade) && pnlClass(dane.pnlCents))}>
                  {maWynik(dane.status as StatusTrade) ? rValue(dane.rMultiple) : TRADE_STATUS_NAMES[dane.status as StatusTrade]}
                  {maWynik(dane.status as StatusTrade) && dane.pnlCents !== null && (
                    <span className="ml-2 text-sekcja text-muted">{money(dane.pnlCents, { sign: true })}</span>
                  )}
                </p>
              )}
              <p className="mt-1 text-meta text-muted">
                {dane.tradingDay ? longDate(dane.tradingDay) : ""} · <span className="num">{timeOnly(dane.entryTime, "America/New_York")}</span> NY · {dane.accountName}
              </p>
            </div>

            <div>
              <p className="mb-2 text-meta text-muted">Zrzuty</p>
              {dane.zrzuty.length === 0 ? (
                <p className="text-meta text-faint">Brak zrzutów sprzed wejścia.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {dane.zrzuty.map((z) => (
                    <figure key={z.id} className="m-0">
                      { }
                      <ObrazZrzutu
                        src={`/api/screenshots/${z.thumbnail ?? z.file}`}
                        alt={`Zrzut ${z.interval ?? ""} trade'a #${dane.id}`}
                        className="aspect-video w-full rounded-[var(--radius-tab)] border border-line object-cover"
                      />
                      <figcaption className="num mt-1 text-grupa text-faint">
                        {z.interval ?? "—"} · {z.origin}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-5 text-meta">
              <div>
                <dt className="text-muted">Setup</dt>
                <dd className="mt-0.5 text-text">{dane.plan?.setup ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Proces</dt>
                <dd className="mt-0.5">
                  <ChipProcesu ocena={dane.processGrade} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">Źródło</dt>
                <dd className="mt-0.5 text-text">{dane.dataSource}</dd>
              </div>
              <div>
                <dt className="text-muted">Werdykt AI</dt>
                <dd className="num mt-0.5 text-text">
                  {dane.werdykt ? `${dane.werdykt.pass} ✓ · ${dane.werdykt.fail} ✗` : "—"}
                </dd>
              </div>
              {dane.plan && (
                <div className="col-span-2">
                  <dt className="flex items-center gap-1.5 text-muted">
                    <Lock size={12} className="text-accent" aria-hidden /> Plan zamrożony
                  </dt>
                  <dd className="num mt-0.5 text-text">
                    wejście {price(dane.plan.entryPrice)} · SL {price(dane.plan.stopLoss)} · TP {price(dane.plan.takeProfit)}
                  </dd>
                </div>
              )}
            </dl>

            {dane.notatka && (
              <div className="border-t border-line pt-5">
                <p className="mb-1.5 text-meta text-muted">Notatka</p>
                <p className="text-meta whitespace-pre-wrap text-text">{dane.notatka}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 py-3">
        <Link
          href={`/trades/${id}`}
          className="przejscie inline-flex h-9 w-full items-center justify-center gap-1 rounded-full bg-surface-3 text-karta text-text hover:bg-line-strong"
        >
          Otwórz kartę trade&apos;a <ChevronRight size={15} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}

function dataGrupy(dzien: string): string {
  const d = new Date(`${dzien}T12:00:00Z`);
  return new Intl.DateTimeFormat("pl-PL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** Tyle wierszy idzie w pierwszym HTML i hydratacji; reszta dochodzi po zamalowaniu (Lighthouse mobile, 2026-10-16). */
const PIERWSZA_PARTIA = 30;

export function Ksiega({ wiersze: wszystkieWiersze, tags, lacznie }: { wiersze: WierszKsiegi[]; tags: TagWithCategory[]; lacznie?: number }) {
  const [pelna, setPelna] = useState(false);
  useEffect(() => {
    // Pozostale wiersze po pierwszym malowaniu: ten sam widok koncowy, ale mniej DOM i pracy przy starcie.
    const t = window.setTimeout(() => setPelna(true), 800);
    return () => window.clearTimeout(t);
  }, []);
  const wiersze = pelna ? wszystkieWiersze : wszystkieWiersze.slice(0, PIERWSZA_PARTIA);
  const [zaznaczone, setZaznaczone] = useState<number[]>([]);
  const [podglad, setPodglad] = useState<number | null>(null);
  const [trwa, startTransition] = useTransition();

  if (wiersze.length === 0) {
    return (
      <EmptyState title="Żaden trade nie pasuje do filtrów" description="Zmień zakres dat albo wyczyść filtry, żeby zobaczyć więcej." />
    );
  }

  const wszystkie = zaznaczone.length === wiersze.length;
  // Grupy po dniu w kolejności listy (lista przychodzi posortowana od najnowszego).
  const dni: [string, WierszKsiegi[]][] = [];
  for (const w of wiersze) {
    const ostatni = dni.at(-1);
    if (ostatni && ostatni[0] === w.dzien) ostatni[1].push(w);
    else dni.push([w.dzien, [w]]);
  }
  const przelacz = (id: number) => setZaznaczone((z) => (z.includes(id) ? z.filter((x) => x !== id) : [...z, id]));

  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-3 pb-2 text-meta">
        {zaznaczone.length > 0 ? (
          <>
            <span className="text-muted">zaznaczono {zaznaczone.length}</span>
            <select
              aria-label="Dodaj tag do zaznaczonych"
              className="przejscie h-8 rounded-[var(--radius-tab)] border border-line-strong bg-surface-2 px-2 text-meta text-text"
              defaultValue=""
              disabled={trwa}
              onChange={(e) => {
                const tagId = Number(e.target.value);
                if (!tagId) return;
                e.target.value = "";
                startTransition(async () => {
                  await tagMany(zaznaczone, tagId, true);
                  setZaznaczone([]);
                });
              }}
            >
              <option value="">dodaj tag…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.category}: {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={trwa}
              onClick={() => {
                if (!window.confirm(`Usunąć ${zaznaczone.length} trade'ów? Tego nie da się cofnąć.`)) return;
                startTransition(async () => {
                  await deleteMany(zaznaczone);
                  setZaznaczone([]);
                });
              }}
              className="przejscie inline-flex h-8 items-center gap-1.5 rounded-full border border-loss/40 px-3 text-meta text-loss hover:bg-loss-dim"
            >
              <Trash2 size={13} aria-hidden /> Usuń
            </button>
          </>
        ) : (
          <span className="text-faint">
            {lacznie ?? wiersze.length} {(lacznie ?? wiersze.length) === 1 ? "trade" : "trade'ów"} w widoku
          </span>
        )}
      </div>

      {/* Dni jako grupy z nagłówkiem-paskiem i sumą R (wzór 2a: grupy Linear). Checkbox pojawia się po
          najechaniu na wiersz, przy fokusie i gdy coś jest zaznaczone (bramka etapu 1, runda 2). */}
      <div className="group/tabela overflow-x-auto">
        <table className="w-full text-karta sm:min-w-[720px]">
          <thead>
            <tr className="h-9 border-b border-line text-left text-meta text-muted">
              <th scope="col" className="hidden w-8 pr-2 font-normal sm:table-cell">
                <input
                  type="checkbox"
                  aria-label="Zaznacz wszystkie"
                  checked={wszystkie}
                  onChange={() => setZaznaczone(wszystkie ? [] : wiersze.map((w) => w.id))}
                  className={cx(
                    "size-4 cursor-pointer accent-accent transition-opacity duration-[var(--czas-stan)] focus-visible:opacity-100 group-hover/tabela:opacity-100",
                    zaznaczone.length > 0 ? "opacity-100" : "opacity-0",
                  )}
                />
              </th>
              <th scope="col" className="hidden w-16 pr-4 font-normal sm:table-cell">Godz.</th>
              <th scope="col" className="w-full pr-4 font-normal">Trade</th>
              <th scope="col" className="hidden w-44 pr-4 font-normal md:table-cell">Setup</th>
              <th scope="col" className="hidden w-16 pr-4 font-normal sm:table-cell">Proces</th>
              <th scope="col" className="w-20 pr-4 text-right font-normal">R</th>
              <th scope="col" className="hidden w-32 pr-2 text-right font-normal sm:table-cell">USD</th>
              <th scope="col" className="hidden w-10 font-normal sm:table-cell">
                <span className="sr-only">Podgląd</span>
              </th>
            </tr>
          </thead>
          {dni.map(([dzien, lista]) => {
            const policzalne = lista.filter((w) => maWynik(w.status) && !w.ukryty && w.status !== "missed" && w.r !== null);
            const sumaR = policzalne.reduce((s, w) => s + (w.r ?? 0), 0);
            return (
              <tbody key={dzien}>
                <tr className="h-9 bg-panel">
                  <th scope="rowgroup" colSpan={8} className="px-0 text-left font-normal">
                    <div className="flex items-center justify-between gap-3 border-y border-line px-2 py-1.5 text-meta sm:px-3">
                      <span className="text-text">
                        {dataGrupy(dzien)} <span className="num text-muted">· {lista.length}</span>
                      </span>
                      <span className={cx("num", policzalne.length > 0 ? pnlClass(sumaR) : "text-muted")}>
                        {policzalne.length > 0 ? rValue(sumaR) : "—"}
                      </span>
                    </div>
                  </th>
                </tr>
                {lista.map((w) => {
                  const jestWynik = maWynik(w.status) && !w.ukryty;
                  const aktywny = podglad === w.id;
                  const zaznaczony = zaznaczone.includes(w.id);
                  return (
                    <tr
                      key={w.id}
                      data-trade={w.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                        setPodglad(w.id);
                      }}
                      className={cx(
                        "group przejscie h-12 cursor-pointer border-b border-line",
                        aktywny || zaznaczony ? "bg-surface-2" : "hover:bg-panel",
                      )}
                    >
                      <td className="hidden pr-2 pl-0.5 align-middle sm:table-cell">
                        <input
                          type="checkbox"
                          aria-label={`Zaznacz trade ${w.id}`}
                          checked={zaznaczony}
                          onChange={() => przelacz(w.id)}
                          className={cx(
                            "size-4 cursor-pointer accent-accent transition-opacity duration-[var(--czas-stan)] group-hover:opacity-100 focus-visible:opacity-100",
                            zaznaczone.length > 0 ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </td>
                      <td className="num hidden pr-4 text-muted sm:table-cell">{timeOnly(w.wejscie, w.strefa)}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {/* Na telefonie wiersz z kotwicą na początku (wzór Dime): chip procesu, potem trade i godzina. */}
                        <div className="flex items-center gap-3">
                          <span className="sm:hidden">
                            <ChipProcesu ocena={w.proces} />
                          </span>
                          <div className="min-w-0">
                            <Link href={`/trades/${w.id}`} prefetch={false} className="przejscie text-text hover:text-accent">
                              <span className="num">{w.symbol}</span> <span className="text-muted">{w.kierunek}</span>
                              <span className="num ml-1.5 text-meta text-faint">×{w.kontrakty}</span>
                            </Link>
                            <span className="num block text-meta text-muted sm:hidden">{timeOnly(w.wejscie, w.strefa)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="hidden pr-4 md:table-cell">
                        {w.setup ? (
                          <span className="inline-flex h-6 items-center rounded-full border border-line-strong px-2 text-meta whitespace-nowrap text-muted">
                            {w.setup}
                          </span>
                        ) : (
                          <span className="text-meta text-faint">—</span>
                        )}
                      </td>
                      <td className="hidden pr-4 sm:table-cell">
                        <ChipProcesu ocena={w.proces} />
                      </td>
                      {/* R przed USD (kierunek.md: R zamiast $). */}
                      <td className={cx("num pr-4 text-right whitespace-nowrap", jestWynik && pnlClass(w.r))}>
                        {w.ukryty ? (
                          <span className="inline-flex items-center gap-1 text-meta text-muted">
                            <Lock size={13} className="text-accent" aria-hidden /> ukryty
                          </span>
                        ) : maWynik(w.status) ? (
                          <>
                            {w.status === "missed" && w.r !== null && "~"}
                            {rValue(w.r)}
                          </>
                        ) : (
                          <span className="text-meta text-faint">{TRADE_STATUS_NAMES[w.status]}</span>
                        )}
                      </td>
                      <td className="num hidden pr-2 text-right text-meta whitespace-nowrap text-muted sm:table-cell">
                        {jestWynik ? (
                          <>
                            {money(w.pnl, { currency: w.waluta, sign: true })}
                            {w.wynik === "be" && <span className="ml-1">BE</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden text-right sm:table-cell">
                        <button
                          type="button"
                          onClick={() => setPodglad(w.id)}
                          aria-label={`Podgląd trade'a #${w.id}`}
                          aria-expanded={aktywny}
                          className="przejscie inline-flex h-8 w-8 items-center justify-center rounded-full text-faint hover:bg-surface-3 hover:text-text"
                        >
                          <PanelRightOpen size={15} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      {/* key: nowy trade = nowa szuflada ze swiezym stanem "wczytuje". */}
      {podglad !== null && <Szuflada key={podglad} id={podglad} onClose={() => setPodglad(null)} />}
    </div>
  );
}

