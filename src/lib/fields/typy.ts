/*
 * Czesc modulu pol wlasnych bez zod: typy, nazwy, formatowanie, klucze.
 * Komponenty klienckie (filtry, tabela) importuja stad, a nie z `fields.ts`: zod to ok. 65 KB gzip
 * i trafial do paczki /trades tylko po to, zeby zaimportowac stala albo funkcje formatujaca
 * (Lighthouse mobile, 2026-10-16). Walidacja zostaje w `fields.ts`, ktore re-eksportuje ten plik.
 */

export type FieldType = "text" | "number" | "select" | "multiselect" | "bool" | "date" | "rating";

export type FieldOption = { value: string; color?: string };

export type FieldDef = {
  id: number;
  key: string;
  label: string;
  type: FieldType;
  options: FieldOption[];
  min: string | null;
  max: string | null;
  unit: string | null;
  hint: string | null;
  required: boolean;
  inTable: boolean;
  inStats: boolean;
  scope: "trade" | "backtest" | "both";
  sortOrder: number;
  archived: boolean;
};

export const TYPE_NAMES: Record<FieldType, string> = {
  text: "tekst",
  number: "liczba",
  select: "lista wyboru",
  multiselect: "lista wielokrotnego wyboru",
  bool: "tak / nie",
  date: "data",
  rating: "ocena 1-5",
};

export const TYPE_HINTS: Record<FieldType, string> = {
  text: "Dowolny tekst, na przykład krótki komentarz.",
  number: "Liczba z opcjonalnym zakresem i jednostką.",
  select: "Jedna wartość ze zdefiniowanej przez Ciebie listy.",
  multiselect: "Dowolnie wiele wartości z listy.",
  bool: "Przełącznik tak albo nie.",
  date: "Data.",
  rating: "Ocena w skali od 1 do 5.",
};

/** Typy pol, ktore maja sens jako wymiar w statystykach. */
export const GROUPABLE_TYPES: FieldType[] = ["select", "multiselect", "bool", "rating"];

export const TYPES_WITH_OPTIONS: FieldType[] = ["select", "multiselect"];

export function fieldsForScope(fields: FieldDef[], backtest: boolean): FieldDef[] {
  return fields
    .filter((p) => !p.archived)
    .filter((p) => p.scope === "both" || p.scope === (backtest ? "backtest" : "trade"))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Czy wartosc jest "pusta" w sensie formularza. */
export function isEmpty(w: unknown): boolean {
  return w === undefined || w === null || w === "" || (Array.isArray(w) && w.length === 0);
}

export function formatValue(p: FieldDef, w: unknown): string {
  if (isEmpty(w)) return "—";
  switch (p.type) {
    case "bool":
      return w ? "tak" : "nie";
    case "multiselect":
      return Array.isArray(w) ? w.join(", ") : String(w);
    case "rating":
      return `${w}/5`;
    case "number":
      return p.unit ? `${w} ${p.unit}` : String(w);
    default:
      return String(w);
  }
}

export function optionColor(p: FieldDef, value: string): string | undefined {
  return p.options.find((o) => o.value === value)?.color;
}

/** Klucz musi byc bezpieczny jako nazwa w JSONB i w parametrach adresu. */
export function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
