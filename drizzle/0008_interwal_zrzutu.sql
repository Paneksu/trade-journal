-- Interwal jako atrybut kazdego zrzutu ekranu, nie tylko przypisania tagu
-- (ADR-013 kontra ADR-015). `text`, nie enum: ta sama lista dozwolonych
-- wartosci zyje w kodzie (lib/domain/interwaly.ts), dolozenie np. "2h" nie
-- ma wymagac migracji schematu - identyczne uzasadnienie jak przy
-- "trade_tags"."interval" w migracji 0007.

ALTER TABLE "screenshots" ADD COLUMN "interval" text;
