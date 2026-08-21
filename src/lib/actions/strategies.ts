"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { requireSession } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { backtestSessions, strategies } from "@/lib/db/schema";
import type { ActionState } from "./settings";

function text(d: FormData, k: string): string | null {
  const w = d.get(k);
  if (w === null) return null;
  const s = String(w).trim();
  return s === "" ? null : s;
}

function id(d: FormData, k: string): number | null {
  const n = Number(d.get(k));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* --- Strategie ------------------------------------------------------------ */

export async function saveStrategy(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const strategyId = id(d, "id");
  const name = text(d, "name");
  if (!name) return { error: "Podaj nazwe strategii." };

  // Zasady przychodza jako lista linii. Identyfikatory sa stale, zeby odhaczone
  // punkty przy starych trade'ach nie rozjechaly sie po edycji checklisty.
  const existing = strategyId
    ? ((
        await db
          .select({ rules: strategies.rules })
          .from(strategies)
          .where(eq(strategies.id, strategyId))
          .limit(1)
      )[0]?.rules ?? [])
    : [];
  const byText = new Map(existing.map((r) => [r.text, r.id]));

  const rules = String(d.get("rules") ?? "")
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((line) => ({ id: byText.get(line) ?? randomUUID(), text: line }));

  const row = {
    name,
    description: text(d, "description"),
    rules,
    instrumentId: id(d, "instrumentId"),
    active: d.get("archived") === null,
    color: text(d, "color") ?? "#e8a44c",
  };

  if (strategyId) await db.update(strategies).set(row).where(eq(strategies.id, strategyId));
  else await db.insert(strategies).values(row);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteStrategy(strategyId: number): Promise<ActionState> {
  await requireSession();
  // Trade'y zostaja, tracą tylko przypisanie do strategii (`set null`).
  await db.delete(strategies).where(eq(strategies.id, strategyId));
  revalidatePath("/", "layout");
  return { ok: true };
}

/* --- Sesje backtestu ------------------------------------------------------ */

export async function saveBacktestSession(_p: ActionState, d: FormData): Promise<ActionState> {
  await requireSession();
  const sessionId = id(d, "id");
  const name = text(d, "name");
  if (!name) return { error: "Podaj nazwe sesji." };

  const target = Number(d.get("targetTrades"));
  const balance = Number(String(d.get("startingBalance") ?? "").replace(",", "."));
  const risk = Number(String(d.get("riskPerTrade") ?? "").replace(",", "."));

  const row = {
    name,
    strategyId: id(d, "strategyId"),
    instrumentId: id(d, "instrumentId"),
    interval: text(d, "interval"),
    dataFrom: text(d, "dataFrom"),
    dataTo: text(d, "dataTo"),
    startingBalance: Number.isFinite(balance) ? Math.round(balance * 100) : 0,
    riskPerTrade: Number.isFinite(risk) && risk > 0 ? Math.round(risk * 100) : null,
    targetTrades: Number.isInteger(target) && target > 0 ? target : 100,
    status: (text(d, "status") ?? "running") as "running" | "finished" | "abandoned",
    assumptions: text(d, "assumptions"),
    conclusions: text(d, "conclusions"),
  };

  let savedId: number;
  if (sessionId) {
    await db.update(backtestSessions).set(row).where(eq(backtestSessions.id, sessionId));
    savedId = sessionId;
  } else {
    const [created] = await db
      .insert(backtestSessions)
      .values(row)
      .returning({ id: backtestSessions.id });
    savedId = created.id;
  }

  revalidatePath("/", "layout");
  if (text(d, "stay") === "1") return { ok: true };
  redirect(`/backtest/${savedId}`);
}

export async function deleteBacktestSession(sessionId: number): Promise<void> {
  await requireSession();
  // Kaskada usuwa takze trade'y sesji - to symulacja, nie historia realnego konta.
  await db.delete(backtestSessions).where(eq(backtestSessions.id, sessionId));
  revalidatePath("/", "layout");
  redirect("/backtest");
}
