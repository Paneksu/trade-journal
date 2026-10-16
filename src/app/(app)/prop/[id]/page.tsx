import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PotwierdzenieReguly } from "@/components/decyzje/formularze";
import { FormularzKsiegi, FormularzPresetu, type PresetOpcja } from "@/components/etap3/formularze";
import { ProgOstrzezenia, RODZAJE_KSIEGI, TYPY_DD, wR } from "@/components/etap3/prop-wspolne";
import { Chip, Karta, LiczbaBohater, PasekZuzycia, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { money, percent, pnlClass, shortDate } from "@/lib/format";
import { kontoProp, presetyProp, type KontoProp } from "@/lib/queries/prop";

export const metadata = { title: "Konto prop — Dziennik tradingowy" };

/*
 * Konto prop (UI v2, etap 3). Forma ze wzoru 7b (Mercury Credit Card, Refero 420d8e8e, żywy zrzut 1440): po lewej
 * saldo z paskiem (u nas bufor do DD) i pigułki-wiersze (limit dnia, consistency, gdy trafi SL), po prawej wykres
 * salda z pionowymi liniami siatki i przerywanym progiem (u nas próg DD). Pod spodem wiersz „This month” z liczbami
 * (u nas: reguły i ich wiek) i księga w tabeli z datą w pierwszej kolumnie. Marka: R przed $, Plex Mono.
 */

function PigulkaWiersz({ etykieta, wartosc, opis, ton }: { etykieta: string; wartosc: string; opis?: string; ton?: string }) {
  return (
    <div className="rounded-[var(--radius-tab)] bg-surface-2 px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-karta whitespace-nowrap text-text">{etykieta}</span>
        <span className={cx("num text-karta whitespace-nowrap", ton ?? "text-text")}>{wartosc}</span>
      </div>
      {opis && <p className="mt-0.5 text-meta text-muted">{opis}</p>}
    </div>
  );
}

function WykresSalda({ k }: { k: KontoProp }) {
  const W = 600;
  const H = 236;
  const punkty = [{ dzien: "start", saldoCents: k.konto.startingBalance }, ...k.krzywa];
  const prog = k.status?.state.drawdownFloorCents ?? null;
  if (punkty.length < 2) {
    return <div className="flex h-[236px] lg:h-[340px] items-center justify-center text-meta text-faint">Brak zamkniętych dni na tym koncie.</div>;
  }
  const wartosci = [...punkty.map((p) => p.saldoCents), ...(prog === null ? [] : [prog])];
  const min = Math.min(...wartosci);
  const max = Math.max(...wartosci);
  const zakres = max - min || 1;
  const x = (i: number) => (i / (punkty.length - 1)) * W;
  const y = (v: number) => 10 + (1 - (v - min) / zakres) * (H - 20);
  const linia = punkty.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.saldoCents).toFixed(1)}`).join(" ");
  const pole = `${linia} L${W},${H} L0,${H} Z`;
  const pionowe = [0.2, 0.4, 0.6, 0.8];
  const etykiety = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => punkty[Math.max(1, Math.round(f * (punkty.length - 1)))]);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[236px] lg:h-[340px] w-full" role="img" aria-label={`Saldo konta dzień po dniu (${k.krzywa.length} dni)${prog !== null ? `, próg DD ${money(prog, { decimals: 0 })}` : ""}`}>
        <defs>
          <linearGradient id="saldo-wypelnienie" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-viz-8)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--color-viz-8)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1="0.5" y2="0.5" stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />
        {pionowe.map((f) => (
          <line key={f} x1={f * W} x2={f * W} y1="0" y2={H} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
        ))}
        {prog !== null && <line x1="0" x2={W} y1={y(prog)} y2={y(prog)} stroke="var(--color-loss)" strokeOpacity="0.7" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <path d={pole} fill="url(#saldo-wypelnienie)" />
        <path d={linia} fill="none" stroke="var(--color-viz-8)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-meta text-muted">
        {etykiety.map((p, i) => (
          <span key={`${p.dzien}-${i}`} className="num">
            {shortDate(p.dzien)}
          </span>
        ))}
      </figcaption>
      {prog !== null && (
        <p className="mt-1 text-meta text-muted">
          <span aria-hidden className="mr-1.5 inline-block w-4 border-t border-dashed border-loss align-middle" />
          próg DD {money(prog, { decimals: 0 })}
        </p>
      )}
    </figure>
  );
}

export default async function KontoPropPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const [k, presety] = await Promise.all([kontoProp(n), presetyProp()]);
  if (!k) notFound();
  const s = k.status?.state ?? null;
  const ryzyko = s?.ifStopHit?.riskCents ?? k.konto.defaultRiskAmount ?? null;
  const waluta = k.konto.currency;
  const poziom = s ? s.warnings.reduce<number>((m, w) => Math.max(m, w.level), 0) : 0;
  const obecna = k.status?.rules ?? null;
  const krytyczne = s ? s.warnings.filter((w) => w.level >= 90) : [];
  const pozostale = s ? s.warnings.filter((w) => w.level < 90) : [];
  // Wiersz „Ten miesiąc” (wzór: „This month” z liczbami): wynik handlu, dni i koszty z księgi w bieżącym miesiącu.
  const mies = k.dzis.slice(0, 7);
  const przed = [...k.krzywa].reverse().find((p) => p.dzien < `${mies}-01`)?.saldoCents ?? k.konto.startingBalance;
  const wMies = k.krzywa.filter((p) => p.dzien.startsWith(mies));
  const miesiac = {
    pnlCents: wMies.length ? wMies[wMies.length - 1].saldoCents - przed : 0,
    dni: wMies.length,
    kosztyCents: (k.ksiega?.entries ?? []).filter((w) => w.occurredOn.startsWith(mies) && w.amountCents < 0).reduce((a, w) => a + w.amountCents, 0),
  };
  const opcje: PresetOpcja[] = presety.presets.map((p) => ({
    id: p.id,
    firm: p.firm,
    etykieta: `${p.program} · ${p.phase} · ${money(p.accountSizeCents, { decimals: 0 })}`,
    doWeryfikacji: p.needsVerification,
    wiekDni: p.ageDays,
    feeMiniCents: p.feeRtMiniCents,
    feeMicroCents: p.feeRtMicroCents,
    feeSourceUrl: p.feeSourceUrl,
  }));

  return (
    <Strona>
      <Link href="/prop" className="przejscie inline-flex items-center gap-1 text-meta text-muted hover:text-text">
        <ChevronLeft className="size-3.5" aria-hidden /> Prop
      </Link>
      <header className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-tytul font-medium tracking-tight text-text">{k.konto.name}</h1>
        <ProgOstrzezenia poziom={poziom} />
        {k.status && !k.status.rulesConfirmed && <Chip className="border-dashed">reguły niepotwierdzone</Chip>}
      </header>
      {krytyczne.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-[var(--radius-tab)] border border-loss/40 px-4 py-2" aria-label="Ostrzeżenia powyżej 90%">
          {krytyczne.map((w) => (
            <li key={w.code} className="text-meta text-loss">
              {w.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
        <div>
          <p className="text-meta text-muted">Saldo</p>
          <LiczbaBohater tekst={money(s?.balanceCents ?? k.konto.startingBalance, { currency: waluta })} />
          {s ? (
            <>
              <div className="mt-3">
                <PasekZuzycia zuzycie={s.drawdownUsed} etykieta="Zużycie limitu DD" />
              </div>
              <div className="mt-2 flex justify-between gap-3 text-meta text-muted">
                <span>zużyte {percent(s.drawdownUsed, 0)}</span>
                <span className="num">
                  do DD {wR(s.drawdownBufferCents, ryzyko) ?? ""} · {money(s.drawdownBufferCents, { currency: waluta, decimals: 0 })}
                </span>
              </div>
              <div className="mt-6 space-y-2">
                <PigulkaWiersz
                  etykieta="Limit dnia"
                  wartosc={s.dailyLossBufferCents === null ? "brak" : (wR(s.dailyLossBufferCents, ryzyko) ?? money(s.dailyLossBufferCents, { currency: waluta, decimals: 0 }))}
                  opis={s.dailyLossBufferCents === null ? undefined : `zostało ${money(s.dailyLossBufferCents, { currency: waluta, decimals: 0 })} · dziś ${money(s.todayPnlCents, { currency: waluta, sign: true, decimals: 0 })}`}
                  ton={(s.dailyLossUsed ?? 0) >= 0.9 ? "text-loss" : undefined}
                />
                <PigulkaWiersz
                  etykieta="Gdy trafi SL"
                  wartosc={s.ifStopHit ? `${s.ifStopHit.bufferInR.toFixed(1)}R` : "—"}
                  opis={s.ifStopHit ? `zostanie ${money(s.ifStopHit.bufferAfterCents, { currency: waluta, decimals: 0 })} przy ryzyku ${money(s.ifStopHit.riskCents, { currency: waluta, decimals: 0 })}` : "brak ryzyka domyślnego"}
                  ton={s.ifStopHit?.exceedsLimit ? "text-loss" : undefined}
                />
                {s.consistency && (
                  <PigulkaWiersz
                    etykieta="Consistency"
                    wartosc={s.consistency.share === null ? "bez zysku" : percent(s.consistency.share, 0)}
                    opis={`największy dzień ${money(s.consistency.bestDayCents, { currency: waluta, decimals: 0 })}, limit ${s.consistency.pct}%`}
                    ton={s.consistency.violated ? "text-loss" : undefined}
                  />
                )}
                {s.target && (
                  <PigulkaWiersz
                    etykieta="Cel"
                    wartosc={s.target.reached ? "osiągnięty" : (wR(s.target.remainingCents, ryzyko) ?? money(s.target.remainingCents, { currency: waluta, decimals: 0 }))}
                    opis={`brakuje ${money(s.target.remainingCents, { currency: waluta, decimals: 0 })} z ${money(s.target.targetCents, { currency: waluta, decimals: 0 })}`}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-karta text-muted">{k.bladStatusu ?? "Bez reguł na dziś."} Przypnij preset niżej.</p>
          )}
        </div>
        <WykresSalda k={k} />
      </div>

      <section aria-labelledby="ksiega-h" className="mt-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line pb-3">
          <h2 id="ksiega-h" className="text-sekcja text-text">
            Ten miesiąc
          </h2>
          <span className={cx("num text-karta", pnlClass(miesiac.pnlCents))}>{money(miesiac.pnlCents, { currency: waluta, sign: true, decimals: 0 })} z handlu</span>
          <span className="num text-karta text-text">{miesiac.dni} dni handlu</span>
          <span className="num text-karta text-text">koszty {money(miesiac.kosztyCents, { currency: waluta, decimals: 0 })}</span>
          {k.ksiega && (
            <span className={cx("num text-karta", pnlClass(k.ksiega.summary.netCents))}>księga netto {money(k.ksiega.summary.netCents, { currency: waluta, sign: true, decimals: 0 })}</span>
          )}
        </div>
        {k.ksiega && k.ksiega.entries.length > 0 ? (
          <table className="w-full text-karta">
            <caption className="sr-only">Wpisy księgi konta {k.konto.name}</caption>
            <thead>
              <tr className="border-b border-line text-left text-meta text-muted">
                <th className="w-20 py-2 pr-3 font-normal">Data</th>
                <th className="py-2 pr-3 font-normal">Opis</th>
                <th className="py-2 text-right font-normal">Kwota</th>
              </tr>
            </thead>
            <tbody>
              {k.ksiega.entries.map((w) => (
                <tr key={w.id} className="border-b border-line" data-wpis={w.id}>
                  <td className="num py-3 pr-3 align-top text-muted">{shortDate(w.occurredOn)}</td>
                  <td className="py-3 pr-3">
                    <span className="text-text">{RODZAJE_KSIEGI[w.kind] ?? w.kind}</span>
                    {w.note && <span className="block text-meta text-muted">{w.note}</span>}
                  </td>
                  <td className={cx("num py-3 text-right align-top", pnlClass(w.amountCents))}>{money(w.amountCents, { currency: waluta, sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-5 text-karta text-muted">Brak wpisów. Dopisz opłatę za eval, reset albo wypłatę, żeby widzieć realny zwrot.</p>
        )}
        <details className="mt-4">
          <summary className="przejscie cursor-pointer text-karta text-muted hover:text-text">Dodaj wpis do księgi (eval, reset, wypłata)</summary>
          <Karta className="mt-3">
            <FormularzKsiegi accountId={k.konto.id} dzis={k.dzis} />
          </Karta>
        </details>
      </section>

      {pozostale.length > 0 && (
        <section aria-labelledby="ostrz-h" className="mt-10">
          <h2 id="ostrz-h" className="border-b border-line pb-3 text-sekcja text-text">
            Ostrzeżenia
          </h2>
          <ul className="mt-3 space-y-1">
            {pozostale.map((w) => (
              <li key={w.code} className="flex gap-2 text-meta text-muted">
                <span className="num shrink-0 text-text">≥{w.level}%</span>
                {w.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="reguly-h" className="mt-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line pb-3">
          <h2 id="reguly-h" className="text-sekcja text-text">
            Reguły konta
          </h2>
          {obecna && (
            <span className="text-karta text-muted">
              {obecna.preset ? `${obecna.preset.firm} · ${obecna.preset.program} · ${obecna.preset.phase}` : "wpisane ręcznie"} · od {shortDate(obecna.validFrom)}
              {obecna.preset && <> · preset sprzed {obecna.preset.ageDays} dni</>}
            </span>
          )}
          {obecna?.preset?.needsVerification && <Chip className="border-dashed">preset do weryfikacji</Chip>}
        </div>
        {obecna ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 py-5 sm:grid-cols-4">
            {[
              ["Typ DD", TYPY_DD[obecna.ddType] ?? obecna.ddType],
              ["Maks. DD", money(obecna.maxDdCents, { currency: waluta, decimals: 0 })],
              ["Limit dnia", money(obecna.dailyLossCents, { currency: waluta, decimals: 0 })],
              ["Cel", money(obecna.profitTargetCents, { currency: waluta, decimals: 0 })],
              ["Consistency", obecna.consistencyPct === null ? "—" : `${obecna.consistencyPct}%`],
              ["Min. dni", obecna.minDays === null ? "—" : String(obecna.minDays)],
              ["Kontrakty mini / micro", `${obecna.maxContractsMini ?? "—"} / ${obecna.maxContractsMicro ?? "—"}`],
              ["Potwierdzone", obecna.confirmedAt ? shortDate(obecna.confirmedAt.slice(0, 10)) : "nie"],
            ].map(([e, w]) => (
              <div key={e}>
                <dt className="text-meta text-muted">{e}</dt>
                <dd className="num mt-0.5 text-karta text-text">{w}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="py-5 text-karta text-muted">Konto nie ma jeszcze reguł.</p>
        )}
        {obecna && !obecna.confirmedAt && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <p className="text-karta text-muted">Sprawdź wartości z regulaminem firmy i potwierdź:</p>
            <PotwierdzenieReguly id={obecna.id} />
          </div>
        )}
        {k.status?.rulesNote && <p className="mb-6 text-meta text-muted">{k.status.rulesNote}</p>}
        <Karta tytul="Przypnij preset albo nowe reguły">
          <FormularzPresetu accountId={k.konto.id} presety={opcje} dzis={k.dzis} />
        </Karta>
        {k.reguly.length > 1 && (
          <details className="mt-4">
            <summary className="przejscie cursor-pointer text-karta text-muted hover:text-text">Historia reguł ({k.reguly.length})</summary>
            <ul className="mt-2">
              {k.reguly.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-3 border-b border-line py-2 text-meta text-muted">
                  <span>od {shortDate(r.validFrom)} · {r.preset ? `${r.preset.firm} ${r.preset.program}` : "ręczne"}</span>
                  <span className="num">
                    DD {money(r.maxDdCents, { currency: waluta, decimals: 0 })} · {r.confirmedAt ? "potwierdzone" : "niepotwierdzone"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

    </Strona>
  );
}
