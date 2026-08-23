/**
 * Formatowanie liczb i czasu do interfejsu. Wszystko po polsku,
 * ze spacja nierozdzielajaca miedzy liczba a jednostka, zeby nic sie nie lamalo.
 */

import type { Wynik } from "./domain/outcome";

const NBSP = " ";
const MINUS = "−";
const DASH = "—";

export function money(
  cents: number | null | undefined,
  options: { currency?: string; sign?: boolean; decimals?: number } = {},
): string {
  if (cents === null || cents === undefined) return DASH;
  const { currency = "USD", sign = false, decimals = 2 } = options;
  const value = cents / 100;
  const text = new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value));
  if (value < 0) return `${MINUS}${text}`;
  return sign && value > 0 ? `+${text}` : text;
}

export function moneyShort(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return DASH;
  const value = cents / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${symbol}${abs.toLocaleString("pl-PL", { maximumFractionDigits: 0 })}`;
}

export function rValue(r: number | null | undefined, sign = true): string {
  if (r === null || r === undefined) return DASH;
  const text = `${Math.abs(r).toFixed(2)}R`;
  if (r < 0) return `${MINUS}${text}`;
  return sign && r > 0 ? `+${text}` : text;
}

export function percent(share: number | null | undefined, decimals = 1): string {
  if (share === null || share === undefined) return DASH;
  return `${(share * 100).toFixed(decimals).replace(".", ",")}${NBSP}%`;
}

export function num(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("pl-PL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return DASH;
  if (seconds < 60) return `${seconds}${NBSP}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}${NBSP}h ${rest}${NBSP}min` : `${hours}${NBSP}h`;
  const days = Math.floor(hours / 24);
  return `${days}${NBSP}d ${hours % 24}${NBSP}h`;
}

export function dateTime(
  moment: Date | string | null | undefined,
  timezone = "Europe/Warsaw",
): string {
  if (!moment) return DASH;
  const d = typeof moment === "string" ? new Date(moment) : moment;
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function timeOnly(
  moment: Date | string | null | undefined,
  timezone = "Europe/Warsaw",
): string {
  if (!moment) return DASH;
  const d = typeof moment === "string" ? new Date(moment) : moment;
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function shortDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

export function longDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

export function monthName(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Cena instrumentu. Liczbe miejsc po przecinku bierzemy z wielkosci ticku -
 * inaczej wynik dzielenia potrafi pokazac dwanascie cyfr, ktore nic nie znacza.
 */
export function price(
  value: string | number | null | undefined,
  tickSize?: string | number | null,
): string {
  if (value === null || value === undefined || value === "") return DASH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return DASH;

  const decimals = tickDecimals(tickSize);
  return n.toLocaleString("pl-PL", {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  });
}

/** Ile miejsc po przecinku ma sens dla podanej wielkosci ticku. */
export function tickDecimals(tickSize?: string | number | null): number {
  if (tickSize === null || tickSize === undefined || tickSize === "") return 2;
  const t = Number(tickSize);
  if (!Number.isFinite(t) || t <= 0) return 2;
  const text = t.toFixed(10).replace(/0+$/, "");
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(8, text.length - dot - 1);
}

/** Klasa koloru zgodna z jedyna dozwolona konwencja: zielen zysk, czerwien strata. */
export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-flat";
  return value > 0 ? "text-profit" : "text-loss";
}

/** Nazwy wynikow do etykiet i badge'y - BE wielkimi literami, reszta po polsku. */
export const WYNIK_NAZWY: Record<Wynik, string> = {
  zysk: "zysk",
  strata: "strata",
  be: "BE",
};

/** Klasa koloru dla wyniku BE (ADR-011) - taka sama konwencja jak `pnlClass`. */
export function wynikClass(w: Wynik): string {
  if (w === "zysk") return "text-profit";
  if (w === "strata") return "text-loss";
  return "text-flat";
}

/** Poprawna polska odmiana rzeczownika po liczbie. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function tradesCount(n: number): string {
  return `${n}${NBSP}${plural(n, "trade", "trade'y", "trade'ów")}`;
}

export { DASH, NBSP };
