import Link from "next/link";

import { GalleryGrid } from "@/components/gallery/gallery-grid";
import { FilterBar } from "@/components/trades/filter-bar";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import {
  getAccounts,
  getFields,
  getInstruments,
  getStrategies,
  getTags,
} from "@/lib/queries/dictionaries";
import { activeFilterCount, parseFilters, toSearchParams } from "@/lib/queries/filters";
import { countTrades, getTrades } from "@/lib/queries/trades";

export const metadata = { title: "Galeria — Dziennik tradingowy" };

const ROZMIAR_STRONY = 60;

/**
 * Przegladanie trade'ow po zdjeciu i po tagach.
 *
 * Filtry sa te same co na /trades i /stats - jeden `parseFilters`, jeden
 * `FilterBar`, jedno `whereClause`. Rozni sie tylko wartosc domyslna:
 * `withShots` startuje wlaczone, bo galeria bez zdjec nie ma sensu; zdjac je
 * mozna jawnym `?zezrzutem=wszystko` (albo opcja "wszystkie" w pasku filtrow).
 *
 * Paginacja zwyklymi linkami, nie nieskonczonym przewijaniem: dziala bez
 * JavaScriptu, da sie wyslac linkiem i nie psuje powrotu z karty trade'a.
 */
export default async function GaleriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const filtry = parseFilters(params);
  // Domyslnie tylko ze zrzutem - chyba ze adres mowi inaczej.
  if (params.zezrzutem === undefined) filtry.withShots = true;

  const strona = Math.max(1, Number(oneParam(params.strona) ?? 1) || 1);
  const offset = (strona - 1) * ROZMIAR_STRONY;

  const [accounts, instruments, strategies, tags, fields, trades, ile] = await Promise.all([
    getAccounts(),
    getInstruments(),
    getStrategies(),
    getTags(),
    getFields(),
    getTrades(filtry, { limit: ROZMIAR_STRONY, offset }),
    countTrades(filtry),
  ]);

  const stron = Math.max(1, Math.ceil(ile / ROZMIAR_STRONY));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etykieta">Dziennik</p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">Galeria</h1>
        </div>
        <p className="text-sm text-faint">
          {ile === 0 ? "brak trade'ów" : `${ile} trade'ów · strona ${strona} z ${stron}`}
        </p>
      </header>

      <div className="panel">
        <FilterBar
          accounts={accounts}
          instruments={instruments}
          strategies={strategies}
          tags={tags}
          fields={fields}
          activeCount={activeFilterCount(filtry)}
          embedded
        />
      </div>

      {trades.length === 0 ? (
        <p className="panel px-4 py-8 text-center text-sm text-faint">
          Żaden trade nie pasuje do tych filtrów.{" "}
          {filtry.withShots === true && (
            <>
              Domyślnie widać tylko trade&apos;y ze zrzutem —{" "}
              <Link href={linkStrony(filtry, 1, null)} className="text-accent hover:underline">
                pokaż także te bez zdjęcia
              </Link>
            </>
          )}
        </p>
      ) : (
        <GalleryGrid trades={trades} />
      )}

      {stron > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Strony galerii">
          <LinkStrony filtry={filtry} strona={strona - 1} aktywny={strona > 1}>
            ← Poprzednia
          </LinkStrony>
          <span className="liczba text-xs text-faint">
            {strona} / {stron}
          </span>
          <LinkStrony filtry={filtry} strona={strona + 1} aktywny={strona < stron}>
            Następna →
          </LinkStrony>
        </nav>
      )}
    </div>
  );
}

function oneParam(w: string | string[] | undefined): string | undefined {
  return Array.isArray(w) ? w[0] : w;
}

function linkStrony(
  filtry: Parameters<typeof toSearchParams>[0],
  strona: number,
  zeZrzutem: boolean | null = filtry.withShots,
): string {
  const p = toSearchParams({ ...filtry, withShots: zeZrzutem });
  // Brak parametru znaczy w galerii "tylko ze zrzutem", wiec zdjecie filtru
  // musi trafic do adresu JAWNIE - sama nieobecnosc niczego by nie wylaczyla.
  if (zeZrzutem === null) p.set("zezrzutem", "wszystko");
  if (strona > 1) p.set("strona", String(strona));
  const query = p.toString();
  return query ? `/galeria?${query}` : "/galeria";
}

function LinkStrony({
  filtry,
  strona,
  aktywny,
  children,
}: {
  filtry: Parameters<typeof toSearchParams>[0];
  strona: number;
  aktywny: boolean;
  children: React.ReactNode;
}) {
  const klasa = cx(
    "inline-flex h-9 items-center rounded-[var(--radius-control)] border px-3 text-sm",
    aktywny
      ? "border-line-strong text-text hover:border-faint"
      : "pointer-events-none border-line text-faint opacity-50",
  );
  if (!aktywny) {
    return (
      <span className={klasa} aria-disabled>
        {children}
      </span>
    );
  }
  return (
    <Link href={linkStrony(filtry, strona)} className={klasa}>
      {children}
    </Link>
  );
}
