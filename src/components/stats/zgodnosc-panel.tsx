import Link from "next/link";

import { PodstawaSwitch } from "@/components/layout/toolbar";
import { DataPoint, Panel } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import type { StatyZgodnosci } from "@/lib/domain/zgodnosc";
import { toSearchParams, type Filters } from "@/lib/queries/filters";
import type { PodstawaZgodnosci } from "@/lib/queries/oceny";
import { percent, pnlClass, rValue, tradesCount } from "@/lib/format";

const MAX_REGUL = 5;

/** Procent z `statyZgodnosci` (0 do 100) w zapisie jak reszta aplikacji. */
const pct = (w: number | null) => (w === null ? "—" : percent(w / 100, 1));

/**
 * Zgodnosc z regulami wg oceny AI (ADR-028), obok dyscypliny. Procent liczy sie
 * WYLACZNIE z regul ocenionych (zgodna albo zlamana); "nie dotyczy" i
 * "niejasne" oraz trady bez oceny stoja obok jako osobna liczba - sam procent
 * bez nich zawyzalby albo zanizal wynik.
 */
export function ZgodnoscPanel({
  stats,
  filters,
  podstawa,
}: {
  stats: StatyZgodnosci;
  filters: Filters;
  podstawa: PodstawaZgodnosci;
}) {
  const { trady, reguly, zgodaUzytkownika } = stats;
  const przelacznik = <PodstawaSwitch active={podstawa} />;

  if (reguly.ocenione === 0) {
    return (
      <Panel
        title="Zgodność z regułami"
        description="Ocena AI względem Twoich reguł."
        actions={przelacznik}
      >
        <p className="px-4 py-4 text-sm text-faint">
          {trady.nieocenione === 0
            ? "W tym zakresie nie ma jeszcze ocen AI."
            : `Trade'y bez rozstrzygniętej reguły: ${trady.nieocenione} (brak oceny albo same „nie dotyczy” i „niejasne”). Nie ma z czego liczyć zgodności.`}
        </p>
      </Panel>
    );
  }

  const lamane = stats.poRegule.filter((r) => r.niezgodne > 0).slice(0, MAX_REGUL);
  const linkDoRegulyHref = (ruleId: string) => {
    const p = toSearchParams({ ...filters, compliance: null, rule: ruleId, ruleVerdict: "fail" });
    return `/trades?${p.toString()}`;
  };

  return (
    <Panel
      title="Zgodność z regułami"
      description="Ocena AI względem Twoich reguł. Liczymy tylko reguły ocenione."
      actions={przelacznik}
    >
      <div className="grid grid-cols-2 gap-4 px-4 py-3">
        <DataPoint
          label="Trade'y zgodne z regułami"
          valueClassName="text-xl font-semibold"
        >
          {pct(trady.zgodnoscPct)}
          <span className="ml-1 text-xs font-normal text-faint">
            · {trady.zgodne} z {trady.ocenione}
          </span>
        </DataPoint>
        <DataPoint label="Nieocenione" valueClassName="text-muted">
          {tradesCount(trady.nieocenione)}
          <span className="ml-1 text-xs text-faint">poza procentem</span>
        </DataPoint>
        <DataPoint label="Sprawdzenia reguł zgodne">
          {pct(reguly.zgodnoscPct)}
          <span className="ml-1 text-xs text-faint">
            · {reguly.zgodne} z {reguly.ocenione}
          </span>
        </DataPoint>
        <DataPoint label="Reguły bez rozstrzygnięcia" valueClassName="text-muted">
          {reguly.nieocenione}
          <span className="ml-1 text-xs text-faint">nie dotyczy lub niejasne</span>
        </DataPoint>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="etykieta">Średnie R: zgodne a odstępstwo</p>
        <div className="mt-1.5 grid grid-cols-2 gap-4">
          <DataPoint label="Zgodne" valueClassName={pnlClass(trady.sredniaRZgodnych)}>
            {rValue(trady.sredniaRZgodnych)}
            <span className="ml-1 text-xs text-faint">· {tradesCount(trady.probaRZgodnych)}</span>
          </DataPoint>
          <DataPoint label="Z odstępstwem" valueClassName={pnlClass(trady.sredniaRNiezgodnych)}>
            {rValue(trady.sredniaRNiezgodnych)}
            <span className="ml-1 text-xs text-faint">· {tradesCount(trady.probaRNiezgodnych)}</span>
          </DataPoint>
        </div>
        <p className="mt-2 text-xs text-faint">
          Tylko trade&apos;y z policzonym R. Przy małej próbie to szum, nie wniosek.
        </p>
      </div>

      <div className="border-t border-line">
        <p className="etykieta px-4 pt-3">Najczęściej łamane reguły</p>
        {lamane.length === 0 ? (
          <p className="px-4 py-3 text-sm text-faint">Żadna reguła nie została złamana.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-line">
            {lamane.map((r) => (
              <li key={r.ruleId} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm text-text">
                    <span className="liczba mr-1.5 text-xs text-accent">{r.ruleId}</span>
                    {r.ruleText}
                  </p>
                  <p className="liczba shrink-0 text-xs text-loss-bright">
                    złamana {r.niezgodne}× z {r.ocenione}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  Zgodność {pct(r.zgodnoscPct)}
                  {r.sredniaRPrzyZlamaniu !== null && (
                    <>
                      {" · "}średnie R przy złamaniu{" "}
                      <span className={cx("liczba", pnlClass(r.sredniaRPrzyZlamaniu))}>
                        {rValue(r.sredniaRPrzyZlamaniu)}
                      </span>
                    </>
                  )}
                  {r.sredniaRPrzyDotrzymaniu !== null && (
                    <>
                      {" · "}przy dotrzymaniu{" "}
                      <span className={cx("liczba", pnlClass(r.sredniaRPrzyDotrzymaniu))}>
                        {rValue(r.sredniaRPrzyDotrzymaniu)}
                      </span>
                    </>
                  )}
                </p>
                <Link
                  href={linkDoRegulyHref(r.ruleId)}
                  className="mt-1 inline-flex min-h-6 items-center text-xs text-accent hover:underline"
                >
                  Pokaż trade&apos;y ze złamaną regułą {r.ruleId}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {zgodaUzytkownika.wypowiedzi > 0 && (
        <p className="border-t border-line px-4 py-3 text-xs text-faint">
          Zgadzasz się z oceną AI w {zgodaUzytkownika.zgadzaSie} z {zgodaUzytkownika.wypowiedzi}{" "}
          wypowiedzi ({pct(zgodaUzytkownika.zgodaPct)}). To miara wiarygodności samej oceny.
        </p>
      )}
    </Panel>
  );
}
