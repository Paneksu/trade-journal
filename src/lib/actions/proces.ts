"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/guard";
import { ustawOceneProcesu } from "@/lib/decyzje/proces";

export async function ocenProces(tradeId: number, ocena: "A" | "B" | "C" | null): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  if (!Number.isInteger(tradeId) || tradeId < 1) return { ok: false, error: "Brak identyfikatora trade'a." };
  const w = await ustawOceneProcesu(tradeId, ocena);
  if (!w.ok) return { ok: false, error: w.komunikat };
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/trades");
  return { ok: true };
}
