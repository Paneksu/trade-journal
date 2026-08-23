-- Interwal jako atrybut kazdego przypisania tagu do trade'a, nie osobna
-- kategoria tagow (ADR-013). Kazde przypisanie (trade_tags) dostaje wlasny
-- interwal z listy stalej w kodzie (lib/domain/interwaly.ts) - jeden tag
-- "wybicie" moze opisywac wejscie zauwazone na 5m i osobno na 1h.

ALTER TABLE "trade_tags" ADD COLUMN "interval" text;--> statement-breakpoint

-- Mapowanie starych nazw tagow kategorii "timeframe" na kod interwalu.
WITH mapowanie AS (
  SELECT t.id AS tag_id,
    CASE t.name
      WHEN '1 min' THEN '1m'
      WHEN '5 min' THEN '5m'
      WHEN '15 min' THEN '15m'
      WHEN '1 h' THEN '1h'
    END AS interval
  FROM tags t
  JOIN tag_categories c ON c.id = t.category_id
  WHERE c.key = 'timeframe'
),
-- Kazdemu trade'owi z co najmniej jednym tagiem interwalowym przypisujemy
-- dokladnie jeden interwal. Trade oznaczony dwoma tagami interwalu naraz
-- (np. pomylka sprzed migracji) dostaje ten nizszy w kolejnosci z
-- lib/domain/interwaly.ts - drobniejszy interwal niesie wiecej informacji.
-- Lista w array_position musi zostac zsynchronizowana recznie z INTERWALY,
-- gdyby kiedys doszla wartosc "2h" i tak dalej.
przypisania AS (
  SELECT tt.trade_id, m.interval,
    row_number() OVER (
      PARTITION BY tt.trade_id
      ORDER BY array_position(
        ARRAY['30s','1m','2m','3m','4m','5m','15m','30m','1h','4h','D','W','M'],
        m.interval
      )
    ) AS rn
  FROM trade_tags tt
  JOIN mapowanie m ON m.tag_id = tt.tag_id
)
-- Rozlanie wybranego interwalu na pozostale przypisania tagow tego trade'a
-- (te, ktore nie sa same tagiem interwalowym). Znany brzeg, opisany tez w
-- ADR-013: trade otagowany WYLACZNIE tagiem interwalowym traci interwal po
-- tej migracji - nie ma innego przypisania, na ktorym mogl zawisnac.
UPDATE trade_tags tt
SET interval = p.interval
FROM przypisania p
WHERE p.rn = 1
  AND tt.trade_id = p.trade_id
  AND tt.tag_id NOT IN (SELECT tag_id FROM mapowanie);--> statement-breakpoint

-- Sprzatanie starej kategorii: przypisania tagow interwalowych, same tagi,
-- na koniec pusta juz kategoria.
DELETE FROM trade_tags
WHERE tag_id IN (
  SELECT t.id FROM tags t JOIN tag_categories c ON c.id = t.category_id WHERE c.key = 'timeframe'
);--> statement-breakpoint
DELETE FROM tags
WHERE category_id IN (SELECT id FROM tag_categories WHERE key = 'timeframe');--> statement-breakpoint
DELETE FROM tag_categories WHERE key = 'timeframe';
