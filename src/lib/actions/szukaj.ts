"use server";

import { requireSession } from "@/lib/auth/guard";
import { szukaj } from "@/lib/api-v2/szukaj";

/*
 * Paleta Ctrl+K (UI v2). Ta sama funkcja co `GET /api/v2/search` (lib/api-v2/szukaj.ts):
 * jedna definicja normalizacji i ta sama slepa ocena (trade z ukrytym wynikiem i slowa
 * po wejsciu nie wychodza). Akcja tylko za sesja.
 */

export type WynikPalety = {
  typ: "trade" | "notatka" | "slowa";
  id: number;
  tytul: string;
  sciezka: string;
  /** Dokad prowadzi wynik; `null`, gdy ekran docelowy jeszcze nie istnieje (notatki: Mozg, etap 2 fazy 5). */
  href: string | null;
};

function napis(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function szukajWPalecie(q: string): Promise<WynikPalety[]> {
  await requireSession();
  const zapytanie = q.slice(0, 200);
  if (zapytanie.trim().length < 2) return [];
  const { results } = await szukaj(zapytanie, ["trades", "notes", "words"], 15);
  return results.map((w): WynikPalety => {
    if (w.type === "trade") {
      const dzien = napis(w.meta.tradingDay);
      const kierunek = napis(w.meta.direction);
      return {
        typ: "trade",
        id: w.id,
        tytul: w.snippet ? w.snippet.slice(0, 90) : w.title,
        sciezka: [`#${w.id}`, dzien, kierunek].filter(Boolean).join(" · "),
        href: `/trades/${w.id}`,
      };
    }
    if (w.type === "note") {
      return {
        typ: "notatka",
        id: w.id,
        tytul: w.title,
        sciezka: napis(w.meta.kind) ?? "notatka",
        href: null,
      };
    }
    const tradeId = typeof w.meta.tradeId === "number" ? w.meta.tradeId : null;
    const dzien = napis(w.meta.day);
    return {
      typ: "slowa",
      id: w.id,
      tytul: w.title,
      sciezka: tradeId ? `Trade #${tradeId}` : dzien ? `Dzień ${dzien}` : "Słowa użytkownika",
      href: tradeId ? `/trades/${tradeId}?zakladka=notatka` : dzien ? `/calendar?dzien=${dzien}` : null,
    };
  });
}
