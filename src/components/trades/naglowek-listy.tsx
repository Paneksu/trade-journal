import { Plus } from "lucide-react";

import { SourceSwitch, WidokSwitch } from "@/components/layout/toolbar";
import { FilterBar } from "@/components/trades/filter-bar";
import { SavedViews } from "@/components/trades/saved-views";
import { NaglowekStrony, Pigulka } from "@/components/ui/v2";
import type { Account, Instrument } from "@/lib/db/schema";
import type { FieldDef } from "@/lib/fields/fields";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Wspólny nagłówek listy trade'ów i galerii (bramka etapu 1, runda 2: „galeria i lista mają ten sam
 * nagłówek”). Jedno piętro sterowania zamiast trzech: Filtry, Lista/Galeria, źródło i zapis widoku
 * w jednym wierszu (wzór Mercury transactions: Data views · Filters · Date w rzędzie); rozwinięte filtry
 * pokazują się jako panel pod wierszem.
 */
export function NaglowekListy({
  widok,
  zrodlo,
  accounts,
  instruments,
  tags,
  fields,
  reguly,
  aktywneFiltry,
  widoki,
  domyslnieOtwarty = false,
  podpis,
}: {
  widok: "lista" | "galeria";
  zrodlo: string;
  accounts: Account[];
  instruments: Instrument[];
  tags: TagWithCategory[];
  fields: FieldDef[];
  reguly: { id: string; text: string }[];
  aktywneFiltry: number;
  /** Zapisane widoki; `null` = bez zapisu widoku (galeria). */
  widoki: { id: number; name: string; filters: Record<string, string> }[] | null;
  /** Domyślnie zwinięte (wzór: „Filters (1)” z licznikiem); aktywne filtry widać po liczniku przy przycisku. */
  domyslnieOtwarty?: boolean;
  podpis?: React.ReactNode;
}) {
  return (
    <>
      <NaglowekStrony
        tytul="Trade'y"
        podtytul={podpis}
        akcje={
          <Pigulka href="/trades/new" glowna>
            <Plus size={15} aria-hidden /> Nowy trade
          </Pigulka>
        }
      />
      <FilterBar
        accounts={accounts}
        instruments={instruments}
        tags={tags}
        fields={fields}
        reguly={reguly}
        activeCount={aktywneFiltry}
        pasek
        domyslnieOtwarty={domyslnieOtwarty}
        dodatek={
          <>
            <WidokSwitch active={widok} />
            <SourceSwitch active={zrodlo} />
            {widoki && <SavedViews kompakt views={widoki} />}
          </>
        }
      />
    </>
  );
}
