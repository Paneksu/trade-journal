import { z } from "zod";

/**
 * Pola wlasne: uzytkownik definiuje kolumny trade'a i ich slowniki,
 * a formularz, tabela, filtry i statystyki maja to podchwycic bez zmian w kodzie.
 *
 * Wartosci trzymamy w jednej kolumnie JSONB. Walidacja powstaje w locie
 * z definicji - dzieki temu nie da sie zapisac wartosci spoza slownika
 * ani liczby poza zakresem, mimo ze schemat bazy o tych polach nic nie wie.
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
  text: "Dowolny tekst, na przyklad krotki komentarz.",
  number: "Liczba z opcjonalnym zakresem i jednostka.",
  select: "Jedna wartosc ze zdefiniowanej przez Ciebie listy.",
  multiselect: "Dowolnie wiele wartosci z listy.",
  bool: "Przelacznik tak albo nie.",
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

function schemaForField(p: FieldDef): z.ZodTypeAny {
  const allowed = p.options.map((o) => o.value);

  switch (p.type) {
    case "number": {
      let s = z.number({ message: `${p.label}: wpisz liczbe.` });
      if (p.min !== null) s = s.min(Number(p.min), `${p.label}: nie mniej niz ${p.min}.`);
      if (p.max !== null) s = s.max(Number(p.max), `${p.label}: nie wiecej niz ${p.max}.`);
      return s;
    }
    case "rating":
      return z
        .number()
        .int()
        .min(1, `${p.label}: ocena od 1 do 5.`)
        .max(5, `${p.label}: ocena od 1 do 5.`);
    case "bool":
      return z.boolean();
    case "date":
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${p.label}: podaj date.`);
    case "select":
      return allowed.length > 0
        ? z.enum(allowed as [string, ...string[]], { message: `${p.label}: wartosc spoza listy.` })
        : z.string();
    case "multiselect":
      return z.array(
        allowed.length > 0
          ? z.enum(allowed as [string, ...string[]], { message: `${p.label}: wartosc spoza listy.` })
          : z.string(),
      );
    case "text":
    default:
      return z.string().max(2000, `${p.label}: maksymalnie 2000 znakow.`);
  }
}

/** Schemat calego obiektu `custom` zbudowany z aktualnych definicji pol. */
export function fieldsSchema(fields: FieldDef[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of fields) {
    const base = schemaForField(p);
    shape[p.key] = p.required ? base : base.optional().nullable();
  }
  // `strip` wycina klucze po usunietych polach, zeby JSONB nie puchl.
  return z.object(shape).strip() as unknown as z.ZodType<Record<string, unknown>>;
}

/** Czy wartosc jest "pusta" w sensie formularza. */
function isEmpty(w: unknown): boolean {
  return w === undefined || w === null || w === "" || (Array.isArray(w) && w.length === 0);
}

/**
 * Zamienia surowe dane z formularza (same stringi) na typy zgodne z definicjami.
 * Klucz pola w formularzu: `field__<klucz>`.
 */
export function readFromForm(fields: FieldDef[], data: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const p of fields) {
    const name = `field__${p.key}`;

    if (p.type === "multiselect") {
      const values = data
        .getAll(name)
        .map(String)
        .filter((w) => w !== "");
      if (values.length > 0) result[p.key] = values;
      continue;
    }

    const raw = data.get(name);
    if (p.type === "bool") {
      // Trzy stany: "tak", "nie" i "nie wypelniono". Checkbox potrafi tylko dwa,
      // dlatego pole tak/nie jest lista wyboru z pusta opcja.
      const w = raw === null ? "" : String(raw);
      if (w === "true") result[p.key] = true;
      else if (w === "false") result[p.key] = false;
      continue;
    }

    if (raw === null || String(raw).trim() === "") continue;
    const text = String(raw).trim();

    if (p.type === "number" || p.type === "rating") {
      const value = Number(text.replace(",", "."));
      if (Number.isFinite(value)) result[p.key] = value;
      continue;
    }

    result[p.key] = text;
  }

  return result;
}

export type FieldError = { key: string; message: string };

/** Sprawdza wartosci i zwraca liste bledow gotowa do pokazania przy polach. */
export function validateValues(
  fields: FieldDef[],
  values: Record<string, unknown>,
): FieldError[] {
  const errors: FieldError[] = [];

  for (const p of fields) {
    const w = values[p.key];
    if (isEmpty(w)) {
      if (p.required) errors.push({ key: p.key, message: `${p.label}: pole wymagane.` });
      continue;
    }
    const result = schemaForField(p).safeParse(w);
    if (!result.success) {
      errors.push({
        key: p.key,
        message: result.error.issues[0]?.message ?? `${p.label}: nieprawidlowa wartosc.`,
      });
    }
  }

  return errors;
}

/** Usuwa wartosci pol, ktorych juz nie ma w definicjach. */
export function cleanValues(
  fields: FieldDef[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(fields.map((p) => p.key));
  const result: Record<string, unknown> = {};
  for (const [k, w] of Object.entries(values)) {
    if (known.has(k) && !isEmpty(w)) result[k] = w;
  }
  return result;
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

export const fieldDefinitionSchema = z.object({
  label: z.string().min(1, "Podaj nazwe pola.").max(60, "Nazwa moze miec do 60 znakow."),
  type: z.enum(["text", "number", "select", "multiselect", "bool", "date", "rating"]),
  required: z.boolean(),
  inTable: z.boolean(),
  inStats: z.boolean(),
  scope: z.enum(["trade", "backtest", "both"]),
});
