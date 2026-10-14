import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Wyszukiwanie (model-danych 7, ADR-029): konfiguracja `simple` + `unaccent`
 * (przez IMMUTABLE `f_unaccent`) + `pg_trgm`. Nie `polish` - Postgres nie ma
 * wbudowanego slownika polskiego. Pelnotekstowo lapiemy cale slowa i prefiks
 * (Ctrl+K dziala w trakcie pisania), a trigramy i LIKE lapia odmiany i literowki.
 * Test z planu: "zarzadzanie" znajduje "Zarzadzanie" (i "ł" -> "l").
 */

export type TypWyniku = "notes" | "words" | "trades";

export type WynikSzukania = {
  type: "note" | "user_words" | "trade";
  id: number;
  rank: number;
  title: string;
  snippet: string;
  /** Pola specyficzne dla typu (kind/slug notatki, kotwice slow, dzien trade'a). */
  meta: Record<string, unknown>;
};

/** Slowa z zapytania: same litery i cyfry, zeby nic z nich nie stalo sie skladnia tsquery. */
export function tokenyZapytania(q: string): string[] {
  return q
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 10);
}

/** Wzorzec do LIKE ... ESCAPE '\' z doslownego tekstu. */
function wzorzecLike(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

type Wiersz = { id: number; rank: number; title: string; snippet: string; meta: Record<string, unknown> };

export async function szukaj(q: string, typy: TypWyniku[], limit: number): Promise<{ results: WynikSzukania[]; tokens: string[] }> {
  const tokeny = tokenyZapytania(q);
  if (tokeny.length === 0) return { results: [], tokens: [] };

  // Kazde slowo jako prefiks, polaczone AND. Skladnie tsquery buduje BAZA, po unaccent: unaccent potrafi
  // zamienic znak na nawiasy lub symbole (np. «⑴» -> «(1)»), ktore w tsquery sa skladnia i dawaly 500.
  // Po unaccent zostawiamy wylacznie litery i cyfry; token, z ktorego nic nie zostaje, odpada.
  const wartosciTokenow = sql.join(
    tokeny.map((t) => sql`(${t}::text)`),
    sql`, `,
  );
  const tsq = sql`coalesce((
    select string_agg(x || ':*', ' & ')
      from (select regexp_replace(public.f_unaccent(v.tok), '[^[:alnum:]]+', '', 'g') as x
              from (values ${wartosciTokenow}) as v(tok)) q
     where x <> ''), '')`;
  const wzorzec = wzorzecLike(q);
  // lower(f_unaccent(q)) liczy baza, tak samo jak indeksy - jedna definicja normalizacji.
  const qn = sql`lower(public.f_unaccent(${q.trim()}))`;
  const zapytanie = sql`to_tsquery('simple', ${tsq})`;
  const wzorzecN = sql`lower(public.f_unaccent(${wzorzec}))`;

  const wyniki: WynikSzukania[] = [];

  if (typy.includes("notes")) {
    const wiersze = await db.execute<Wiersz>(sql`
      select n.id,
             greatest(coalesce(ts_rank(n.search, ${zapytanie}), 0),
                      similarity(lower(public.f_unaccent(n.title)), ${qn})) as rank,
             n.title,
             left(n.body_md, 200) as snippet,
             jsonb_build_object('kind', n.kind, 'slug', n.slug, 'rev', n.rev, 'archived', n.archived_at is not null) as meta
        from notes n
       where n.archived_at is null
         and (n.search @@ ${zapytanie}
              or lower(public.f_unaccent(n.title)) % ${qn}
              or lower(public.f_unaccent(n.title)) like ${wzorzecN} escape '\\'
              or lower(public.f_unaccent(n.body_md)) like ${wzorzecN} escape '\\')
       order by rank desc, n.id
       limit ${limit}`);
    for (const w of wiersze) wyniki.push({ type: "note", id: w.id, rank: Number(w.rank), title: w.title, snippet: w.snippet, meta: w.meta });
  }

  if (typy.includes("words")) {
    const wiersze = await db.execute<Wiersz>(sql`
      select w.id,
             greatest(coalesce(ts_rank(w.search, ${zapytanie}), 0), 0.05) as rank,
             left(w.text, 80) as title,
             left(w.text, 200) as snippet,
             jsonb_build_object('source', w.source, 'role', w.role, 'tradeId', w.trade_id, 'noteId', w.note_id,
                                'backtestSessionId', w.backtest_session_id, 'day', w.day) as meta
        from user_words w
       where w.search @@ ${zapytanie}
          or lower(public.f_unaccent(w.text)) like ${wzorzecN} escape '\\'
       order by rank desc, w.id
       limit ${limit}`);
    for (const w of wiersze) wyniki.push({ type: "user_words", id: w.id, rank: Number(w.rank), title: w.title, snippet: w.snippet, meta: w.meta });
  }

  if (typy.includes("trades")) {
    // Ten sam wyrazenie co kolumna `trades.search` z migracji 0019 (faza 2b); do tego czasu bez indeksu.
    const wiersze = await db.execute<Wiersz>(sql`
      select t.id,
             greatest(coalesce(ts_rank(to_tsvector('simple', public.f_unaccent(coalesce(t.note, '') || ' ' || coalesce(t.mood_note, ''))), ${zapytanie}), 0), 0.05) as rank,
             ('Trade #' || t.id || ' ' || t.trading_day::text) as title,
             left(coalesce(t.note, t.mood_note, ''), 200) as snippet,
             jsonb_build_object('tradingDay', t.trading_day, 'direction', t.direction, 'status', t.status::text) as meta
        from trades t
       where to_tsvector('simple', public.f_unaccent(coalesce(t.note, '') || ' ' || coalesce(t.mood_note, ''))) @@ ${zapytanie}
          or lower(public.f_unaccent(coalesce(t.note, '') || ' ' || coalesce(t.mood_note, ''))) like ${wzorzecN} escape '\\'
       order by rank desc, t.id
       limit ${limit}`);
    for (const w of wiersze) wyniki.push({ type: "trade", id: w.id, rank: Number(w.rank), title: w.title, snippet: w.snippet, meta: w.meta });
  }

  wyniki.sort((a, b) => b.rank - a.rank || a.id - b.id);
  return { results: wyniki.slice(0, limit), tokens: tokeny };
}
