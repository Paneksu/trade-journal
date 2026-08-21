"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Image as ImageIcon, Trash2 } from "lucide-react";

import { Badge, Button, EmptyState } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { deleteMany, tagMany } from "@/lib/actions/trades";
import { SESSION_NAMES, TRADE_STATUS_NAMES } from "@/lib/domain/types";
import { formatValue, type FieldDef } from "@/lib/fields/fields";
import { dateTime, duration, int, money, num, pnlClass, price, rValue } from "@/lib/format";
import type { TradeRecord } from "@/lib/queries/trades";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Tabela trade'ow. Kolumny wlacza sie i wylacza, sortowanie dziala po kazdej
 * liczbie, a pola wlasne oznaczone jako "pokaz w tabeli" dokladaja sie same.
 */

type Props = {
  trades: TradeRecord[];
  fields: FieldDef[];
  tags: TagWithCategory[];
  timezone: string;
  currency: string;
};

const STORAGE_KEY = "tj-kolumny";

export function TradesTable({ trades, fields, tags, timezone, currency }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "entryTime", desc: true }]);
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as VisibilityState;
    } catch {
      return {};
    }
  });
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [showColumns, setShowColumns] = useState(false);
  const [pending, startTransition] = useTransition();

  const tableFields = useMemo(
    () => fields.filter((f) => f.inTable && !f.archived),
    [fields],
  );

  const columns = useMemo<ColumnDef<TradeRecord>[]>(() => {
    const base: ColumnDef<TradeRecord>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Zaznacz wszystkie"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Zaznacz trade ${row.original.id}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
        ),
        enableSorting: false,
        size: 32,
      },
      {
        id: "entryTime",
        accessorFn: (t) => t.entryTime.getTime(),
        header: "Wejście",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-faint">
            {dateTime(row.original.entryTime, timezone)}
          </span>
        ),
      },
      {
        id: "instrumentSymbol",
        accessorKey: "instrumentSymbol",
        header: "Symbol",
        cell: ({ getValue }) => (
          <span className="font-mono text-text">{getValue() as string}</span>
        ),
      },
      {
        id: "direction",
        accessorKey: "direction",
        header: "Kier.",
        cell: ({ getValue }) => {
          const w = getValue() as string;
          return (
            <span className={cx("text-xs font-semibold uppercase", w === "long" ? "text-profit" : "text-loss")}>
              {w}
            </span>
          );
        },
      },
      {
        id: "contracts",
        accessorKey: "contracts",
        header: "Kontr.",
        cell: ({ getValue }) => <span className="text-muted">{num(getValue() as number, 0)}</span>,
      },
      {
        id: "entryPrice",
        accessorFn: (t) => Number(t.entryPrice),
        header: "Wejście",
        cell: ({ row }) => (
          <span className="text-muted">{price(row.original.entryPrice, row.original.tickSize)}</span>
        ),
      },
      {
        id: "exitPrice",
        accessorFn: (t) => (t.exitPrice === null ? null : Number(t.exitPrice)),
        header: "Wyjście",
        cell: ({ row }) => (
          <span className="text-muted">{price(row.original.exitPrice, row.original.tickSize)}</span>
        ),
      },
      {
        id: "ticks",
        accessorKey: "ticks",
        header: "Ticki",
        cell: ({ getValue }) => {
          const w = getValue() as number | null;
          return <span className={pnlClass(w)}>{w === null ? "—" : int(w)}</span>;
        },
      },
      {
        id: "rMultiple",
        accessorKey: "rMultiple",
        header: "R",
        cell: ({ getValue }) => {
          const w = getValue() as number | null;
          return <span className={cx("font-medium", pnlClass(w))}>{rValue(w)}</span>;
        },
      },
      {
        id: "pnlNet",
        accessorKey: "pnlNet",
        header: "Wynik netto",
        cell: ({ row }) =>
          row.original.status === "closed" ? (
            <span className={cx("font-medium", pnlClass(row.original.pnlNet))}>
              {money(row.original.pnlNet, { currency: row.original.currency, sign: true })}
            </span>
          ) : (
            <span className="text-faint">{TRADE_STATUS_NAMES[row.original.status]}</span>
          ),
      },
      {
        id: "durationS",
        accessorKey: "durationS",
        header: "Czas",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-faint">{duration(getValue() as number | null)}</span>
        ),
      },
      {
        id: "marketSession",
        accessorKey: "marketSession",
        header: "Sesja",
        cell: ({ getValue }) => {
          const w = getValue() as keyof typeof SESSION_NAMES | null;
          return <span className="text-faint">{w ? SESSION_NAMES[w] : "—"}</span>;
        },
      },
      {
        id: "strategyName",
        accessorKey: "strategyName",
        header: "Strategia",
        cell: ({ getValue }) => <span className="text-muted">{(getValue() as string) ?? "—"}</span>,
      },
      {
        id: "tags",
        accessorFn: (t) => t.tags.map((x) => x.name).join(", "),
        header: "Tagi",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.tags.map((tag) => (
              <Badge key={tag.id} color={tag.color} title={tag.category}>
                {tag.name}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        id: "executionRating",
        accessorKey: "executionRating",
        header: "Ocena",
        cell: ({ getValue }) => {
          const w = getValue() as number | null;
          return <span className="text-muted">{w === null ? "—" : `${w}/5`}</span>;
        },
      },
      {
        id: "screenshotCount",
        accessorKey: "screenshotCount",
        header: "Zrzuty",
        cell: ({ getValue }) => {
          const w = getValue() as number;
          return w > 0 ? (
            <span className="inline-flex items-center gap-1 text-faint">
              <ImageIcon size={13} aria-hidden />
              {w}
            </span>
          ) : (
            <span className="text-faint">—</span>
          );
        },
      },
    ];

    for (const f of tableFields) {
      base.push({
        id: `field_${f.key}`,
        accessorFn: (t) => t.custom?.[f.key] ?? null,
        header: f.label,
        cell: ({ row }) => (
          <span className="text-muted">{formatValue(f, row.original.custom?.[f.key])}</span>
        ),
      });
    }

    return base;
  }, [tableFields, timezone]);

  /* React Compiler nie memoizuje tego wywolania (API zwraca funkcje, ktore
     nie sa stabilne). Tabela dziala poprawnie, tylko bez memoizacji. */
  const table = useReactTable({
    data: trades,
    columns,
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(visibility) : updater;
      setVisibility(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Brak dostepu do localStorage nie moze psuc tabeli.
      }
    },
    onRowSelectionChange: setSelection,
    getRowId: (row) => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
  });

  const selectedIds = Object.keys(selection)
    .filter((k) => selection[k])
    .map(Number);

  if (trades.length === 0) {
    return (
      <EmptyState
        title="Żaden trade nie pasuje do filtrów"
        description="Zmień zakres dat albo wyczyść filtry, żeby zobaczyć więcej."
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.length > 0 ? (
            <>
              <span className="text-xs text-muted">zaznaczono {selectedIds.length}</span>
              <select
                aria-label="Dodaj tag do zaznaczonych"
                className="h-7 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2 text-xs text-text"
                defaultValue=""
                disabled={pending}
                onChange={(e) => {
                  const tagId = Number(e.target.value);
                  if (!tagId) return;
                  e.target.value = "";
                  startTransition(async () => {
                    await tagMany(selectedIds, tagId, true);
                    setSelection({});
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
              <Button
                size="s"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Usunąć ${selectedIds.length} trade'ów? Tego nie da się cofnąć.`)) {
                    return;
                  }
                  startTransition(async () => {
                    await deleteMany(selectedIds);
                    setSelection({});
                  });
                }}
              >
                <Trash2 size={13} aria-hidden />
                Usuń
              </Button>
            </>
          ) : (
            <span className="text-xs text-faint">
              {trades.length} {trades.length === 1 ? "trade" : "trade'ów"} w widoku
            </span>
          )}
        </div>

        <div className="relative">
          <Button size="s" onClick={() => setShowColumns((w) => !w)} aria-expanded={showColumns}>
            <Columns3 size={13} aria-hidden />
            Kolumny
          </Button>
          {showColumns && (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-[var(--radius-panel)] border border-line-strong bg-surface-3 p-2 shadow-[var(--shadow-pop)]">
              {table
                .getAllLeafColumns()
                .filter((c) => c.id !== "select")
                .map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <input
                      type="checkbox"
                      checked={c.getIsVisible()}
                      onChange={c.getToggleVisibilityHandler()}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line">
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-left align-middle"
                      aria-sort={
                        dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined
                      }
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="etykieta inline-flex items-center gap-1 hover:text-text"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === "asc" ? (
                            <ArrowUp size={11} aria-hidden />
                          ) : dir === "desc" ? (
                            <ArrowDown size={11} aria-hidden />
                          ) : (
                            <ChevronsUpDown size={11} className="opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <span className="etykieta">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cx(
                  "border-b border-line transition-colors duration-150 hover:bg-surface-2",
                  row.getIsSelected() && "bg-surface-2",
                )}
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td key={cell.id} className="liczba px-3 py-2 align-middle">
                    {i === 1 ? (
                      <Link href={`/trades/${row.original.id}`} className="block hover:text-accent">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Link>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-xs text-faint">
        Kliknij datę wejścia, żeby otworzyć kartę trade&apos;a. Waluta widoku: {currency}.
      </p>
    </div>
  );
}
