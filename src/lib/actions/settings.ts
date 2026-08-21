"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { accounts, instruments, settings } from "@/lib/db/schema";

export type ActionState = { ok?: boolean; error?: string };

function text(d: FormData, k: string): string | null {
  const w = d.get(k);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function number(d: FormData, k: string): number | null {
  const s = text(d, k);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cents(d: FormData, k: string): number | null {
  const n = number(d, k);
  return n === null ? null : Math.round(n * 100);
}

function checkbox(d: FormData, k: string): boolean {
  return d.get(k) !== null;
}

/* --- Konta ---------------------------------------------------------------- */

export async function saveAccount(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const id = number(d, "id");
  const name = text(d, "name");
  if (!name) return { error: "Podaj nazwe konta." };

  const row = {
    name,
    currency: text(d, "currency") ?? "USD",
    startingBalance: cents(d, "startingBalance") ?? 0,
    type: (text(d, "type") ?? "live") as "live" | "demo" | "prop" | "paper",
    defaultRiskAmount: cents(d, "defaultRiskAmount"),
    defaultRiskPct: text(d, "defaultRiskPct"),
    description: text(d, "description"),
    archived: checkbox(d, "archived"),
    sortOrder: Math.round(number(d, "sortOrder") ?? 0),
  };

  if (id) await db.update(accounts).set(row).where(eq(accounts.id, id));
  else await db.insert(accounts).values(row);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAccount(id: number): Promise<ActionState> {
  await requireSession();
  try {
    await db.delete(accounts).where(eq(accounts.id, id));
  } catch {
    // Klucz obcy z `restrict` chroni historie: konta z trade'ami sie nie usuwa.
    return { error: "Na tym koncie sa trade'y. Zamiast usuwac, zarchiwizuj je." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/* --- Instrumenty ---------------------------------------------------------- */

export async function saveInstrument(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const id = number(d, "id");
  const symbol = text(d, "symbol")?.toUpperCase();
  const name = text(d, "name");
  const tickSize = number(d, "tickSize");
  const tickValue = number(d, "tickValue");

  if (!symbol) return { error: "Podaj symbol instrumentu." };
  if (!name) return { error: "Podaj nazwe instrumentu." };
  if (tickSize === null || tickSize <= 0) return { error: "Wielkosc ticku musi byc wieksza od zera." };
  if (tickValue === null || tickValue <= 0) return { error: "Wartosc ticku musi byc wieksza od zera." };

  const row = {
    symbol,
    name,
    exchange: text(d, "exchange"),
    tickSize: String(tickSize),
    // W formularzu wartosc ticku podaje sie w dolarach, w bazie w tysiecznych.
    tickValue: Math.round(tickValue * 1000),
    currency: text(d, "currency") ?? "USD",
    commissionPerContract: cents(d, "commissionPerContract") ?? 0,
    rthFrom: text(d, "rthFrom") ?? "09:30",
    rthTo: text(d, "rthTo") ?? "16:00",
    exchangeTimezone: text(d, "exchangeTimezone") ?? "America/New_York",
    active: !checkbox(d, "inactive"),
    sortOrder: Math.round(number(d, "sortOrder") ?? 0),
  };

  try {
    if (id) await db.update(instruments).set(row).where(eq(instruments.id, id));
    else await db.insert(instruments).values(row);
  } catch {
    return { error: `Instrument o symbolu ${symbol} juz istnieje.` };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteInstrument(id: number): Promise<ActionState> {
  await requireSession();
  try {
    await db.delete(instruments).where(eq(instruments.id, id));
  } catch {
    return { error: "Na tym instrumencie sa trade'y. Zamiast usuwac, oznacz go jako nieaktywny." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/* --- Ustawienia ogolne ---------------------------------------------------- */

export async function saveSettings(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();

  const minSample = Math.round(number(d, "minSample") ?? 15);
  if (minSample < 3) return { error: "Prog istotnosci ponizej trzech trade'ow nie ma sensu." };

  await db
    .update(settings)
    .set({
      baseCurrency: text(d, "baseCurrency") ?? "USD",
      timezone: text(d, "timezone") ?? "Europe/Warsaw",
      defaultRisk: cents(d, "defaultRisk") ?? 10_000,
      minSample,
      tradingHoursFrom: text(d, "tradingHoursFrom"),
      tradingHoursTo: text(d, "tradingHoursTo"),
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  revalidatePath("/", "layout");
  return { ok: true };
}
