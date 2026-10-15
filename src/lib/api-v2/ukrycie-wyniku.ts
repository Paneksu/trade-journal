import "server-only";
import { and, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { trades } from "@/lib/db/schema";

import type { Transakcja } from "./zapis";

/**
 * Slepa ocena: dopoki trade nie jest zamkniety, a ma werdykt AI wydany przed wynikiem, wszystko, co moze zdradzic
 * wynik, jest ukryte WE WSZYSTKICH odczytach API (review i audyt, 15.10.2026). JEDEN wspolny mechanizm:
 *  - `sqlWynikUkryty(trade)`: trade jest otwarty i ma werdykt;
 *  - `sqlWejscieTradu(trade)`: jedna definicja wejscia = najwczesniejsze znane (least z czasem przypiecia planu);
 *  - `sqlPoWejsciu(trade, t)`: `t` jest po wejsciu trade'a z ukrytym wynikiem;
 *  - `sqlSlowaUkryte(...)`, `sqlNotatkaUkryta(...)`: reguly dla slow i notatek (trade, dzien, notatka, czas);
 *  - te same reguly w aplikacji: `czyWynikUkryty`, `ukryteTrady`, `czyNotatkaUkryta`, `czySlowaUkryte`, `wejscieTradu`.
 * Slowa, notatki i dopiski sa ukrywane tylko wtedy, gdy powstaly PO wejsciu: to, co napisano przed wejsciem
 * (plan, teza), jest dowodem decyzji, nie wynikiem. Zrzuty ekranu i geometria rysunkow zrobione po wejsciu nie
 * wychodza wcale (Slowa uzytkownika/ADR: wynik moze byc widoczny na wykresie).
 */

type Db = Transakcja | typeof db;

/** Warunek SQL: trade `tradeId` jest otwarty i ma werdykt. `tradeId` to wyrazenie SQL (kolumna albo alias). */
export function sqlWynikUkryty(tradeId: SQL): SQL {
  return sql`(exists (select 1 from trades uw_t where uw_t.id = ${tradeId} and uw_t.status::text <> 'closed')
    and exists (select 1 from trade_reviews uw_r where uw_r.trade_id = ${tradeId}))`;
}

/**
 * Wyrazenie SQL: JEDNA definicja wejscia trade'a dla calej slepej oceny = najwczesniejsze znane wejscie, czyli
 * least(entry_time_at_attach planu, biezace entry_time). `least` w Postgresie pomija NULL-e. Najwczesniejsze wejscie
 * ukrywa wiecej, wiec jest bezpieczniejsze (decyzja sesji glownej 15.10.2026, zgodna ze Slowami uzytkownika
 * «Ukrywaj tylko notatki po wejsciu»).
 */
export function sqlWejscieTradu(tradeId: SQL): SQL {
  return sql`least((select uw_p.entry_time_at_attach from trade_plans uw_p where uw_p.trade_id = ${tradeId} limit 1),
    (select uw_e.entry_time from trades uw_e where uw_e.id = ${tradeId}))`;
}

/** Warunek SQL: trade z ukrytym wynikiem i czas `t` po jego wejsciu (NULL czasu = nieznany = po wejsciu). */
export function sqlPoWejsciu(tradeId: SQL, t: SQL): SQL {
  return sql`(${sqlWynikUkryty(tradeId)} and (${t} is null or ${t} > ${sqlWejscieTradu(tradeId)}))`;
}

/**
 * Warunek SQL: notatka jest ukryta. Dwie kotwice (Slowa uzytkownika, 15.10.2026: «Ukrywaj tylko notatki po wejsciu» i
 * «Ukryj tez notatki dnia po wejsciu»):
 *  - notatka przypieta do trade'a z ukrytym wynikiem, utworzona albo zmieniana po jego wejsciu;
 *  - notatka z kotwica `day` dnia, w ktorym jest trade z ukrytym wynikiem, utworzona albo zmieniana po najwczesniejszym
 *    wejsciu takiego trade'a.
 * Notatka sprzed wejscia, ale edytowana po wejsciu, jest ukryta w calosci (bezpieczniej niz pokazywanie starej wersji;
 * rewizji tresci API nie wystawia).
 */
export function sqlNotatkaUkryta(tradeId: SQL, createdAt: SQL, updatedAt: SQL, day: SQL): SQL {
  return sql`((${sqlWynikUkryty(tradeId)} and greatest(${createdAt}, ${updatedAt}) > ${sqlWejscieTradu(tradeId)})
    or (${day} is not null and exists (select 1 from trades uw_d
          where uw_d.trading_day = ${day}
            and ${sqlWynikUkryty(sql`uw_d.id`)}
            and greatest(${createdAt}, ${updatedAt}) > ${sqlWejscieTradu(sql`uw_d.id`)})))`;
}

/** Stara nazwa (przed rozszerzeniem o dzien): zachowana dla czytelnosci wywolan, `day` jest teraz wymagany. */
export const sqlNotatkaPoWejsciuUkrytego = sqlNotatkaUkryta;

/**
 * Warunek SQL: slowa uzytkownika sa ukryte, gdy
 *  - powstaly po wejsciu trade'a z ukrytym wynikiem i dotycza tego trade'a albo jego dnia (slowa dnia bez trade'a), albo
 *  - sa przypiete do ukrytej notatki (kolumna note_id).
 * Wszystkie argumenty to wyrazenia SQL (kolumny user_words albo aliasy).
 */
export function sqlSlowaUkryte(a: { tradeId: SQL; day: SQL; capturedAt: SQL; noteId: SQL }): SQL {
  return sql`(exists (select 1 from trades uw_h
      where ${sqlWynikUkryty(sql`uw_h.id`)}
        and ${a.capturedAt} > ${sqlWejscieTradu(sql`uw_h.id`)}
        and (${a.tradeId} = uw_h.id or (${a.tradeId} is null and ${a.day} is not null and ${a.day} = uw_h.trading_day)))
    or (${a.noteId} is not null and exists (select 1 from notes uw_n
      where uw_n.id = ${a.noteId}
        and ${sqlNotatkaUkryta(sql`uw_n.trade_id`, sql`uw_n.created_at`, sql`uw_n.updated_at`, sql`uw_n.day`)})))`;
}

/** Zgodnosc wsteczna wywolan (trade, dzien, czas): bez kotwicy notatki. */
export function sqlSlowaPoWejsciuUkrytego(tradeId: SQL, day: SQL, capturedAt: SQL, noteId: SQL = sql`null`): SQL {
  return sqlSlowaUkryte({ tradeId, day, capturedAt, noteId });
}

/** Podzbior `ids`, ktorych wynik jest ukryty (otwarty trade z werdyktem). */
export async function ukryteTrady(tx: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const wiersze = await tx
    .select({ id: trades.id })
    .from(trades)
    .where(and(inArray(trades.id, ids), sql`${trades.status}::text <> 'closed'`, sql`exists (select 1 from trade_reviews uw_x where uw_x.trade_id = ${trades.id})`));
  return new Set(wiersze.map((w) => w.id));
}

export async function czyWynikUkryty(tx: Db, tradeId: number): Promise<boolean> {
  return (await ukryteTrady(tx, [tradeId])).has(tradeId);
}

export async function czyNotatkaUkryta(tx: Db, noteId: number): Promise<boolean> {
  const [w] = await tx.execute<{ h: boolean | null }>(
    sql`select ${sqlNotatkaUkryta(sql`n.trade_id`, sql`n.created_at`, sql`n.updated_at`, sql`n.day`)} as h from notes n where n.id = ${noteId}`,
  );
  return w?.h === true;
}

/** Podzbior `ids` slow uzytkownika, ktore sa ukryte (jedna regula `sqlSlowaUkryte`, dla odczytow, ktore nie filtruja w SQL). */
export async function ukryteSlowa(tx: Db, ids: (number | null)[]): Promise<Set<number>> {
  const lista = [...new Set(ids.filter((x): x is number => x !== null))];
  if (lista.length === 0) return new Set();
  const wiersze = await tx.execute<{ id: number }>(
    sql`select w.id from user_words w where w.id in (${sql.join(lista.map((i) => sql`${i}`), sql`, `)}) and ${sqlSlowaUkryte({ tradeId: sql`w.trade_id`, day: sql`w.day`, capturedAt: sql`w.captured_at`, noteId: sql`w.note_id` })}`,
  );
  return new Set(wiersze.map((w) => w.id));
}

export async function czySlowaUkryte(tx: Db, wordsId: number): Promise<boolean> {
  const [w] = await tx.execute<{ h: boolean | null }>(
    sql`select ${sqlSlowaUkryte({ tradeId: sql`w.trade_id`, day: sql`w.day`, capturedAt: sql`w.captured_at`, noteId: sql`w.note_id` })} as h from user_words w where w.id = ${wordsId}`,
  );
  return w?.h === true;
}

/** Wejscie trade'a (ta sama definicja co `sqlWejscieTradu`: najwczesniejsze znane); null, gdy trade nie istnieje. */
export async function wejscieTradu(tx: Db, tradeId: number): Promise<Date | null> {
  const [w] = await tx.execute<{ t: Date | string | null }>(sql`select ${sqlWejscieTradu(sql`${tradeId}::int`)} as t`);
  return w?.t == null ? null : new Date(w.t);
}
