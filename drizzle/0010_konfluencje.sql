-- Tagi jako konfluencje z podzialem HTF/LTF wyprowadzonym z interwalu, osobna
-- nazwa setupu, warunki rynkowe skasowane, a ten sam tag moze wisiec na
-- trade'cie kilka razy - po jednym wierszu na interwal (ADR-017).

-- 1. Warunki rynkowe znikaja: przypisania, tagi, na koniec pusta kategoria.
--    Kasowanie idzie migracja, a nie akcja deleteTag/deleteTagCategory - te
--    odmawiaja usuniecia tagu uzytego w trade'ach i maja tak zostac. To jest
--    jednorazowy wyjatek podjety swiadomie, nie furtka omijajaca ta zasade.
DELETE FROM "trade_tags" WHERE "tag_id" IN (
  SELECT t.id FROM "tags" t
  JOIN "tag_categories" c ON c.id = t.category_id
  WHERE c.key = 'market'
);--> statement-breakpoint

DELETE FROM "tags" WHERE "category_id" IN (
  SELECT id FROM "tag_categories" WHERE key = 'market'
);--> statement-breakpoint

DELETE FROM "tag_categories" WHERE "key" = 'market';--> statement-breakpoint

-- 2. Stary "Setup" byl w praktyce lista konfluencji (EQ, RB, fvg, ifvg,
--    otwarcie sesji). Zmieniamy tozsamosc kategorii zamiast przepinac tagi do
--    nowej: "tags"."id" zostaja te same, wiec cala historia w "trade_tags",
--    zapisane widoki (saved_views.filters->'tag' trzyma ID-ki) i linki ?tag=12
--    przezywaja migracje nietkniete.
--
--    Swiadomy koszt: klucz 'setup' oznacza po tej migracji INNA kategorie niz
--    przed nia. Jedyne miejsce, gdzie ten klucz zyje poza baza, to parametr
--    ?wymiar=tag:setup na /stats - nigdzie go nie zapisujemy, wiec stary link
--    pokaze pusta kategorie zamiast konfluencji. To wszystko.
UPDATE "tag_categories"
SET "key" = 'confluence',
    "name" = 'Konfluencje',
    "description" = 'Przesłanki, które złożyły się na wejście. Interwał wybierasz osobno dla każdej — z niego wynika podział na HTF i LTF.',
    "sort_order" = 10
WHERE "key" = 'setup';--> statement-breakpoint

-- 3. Pusta kategoria na nazwe calego zagrania. Seed jej nie wypelnia: nikt
--    poza uzytkownikiem nie wie, jak on nazywa swoje setupy.
INSERT INTO "tag_categories" ("name", "key", "description", "sort_order")
SELECT 'Setup', 'setup', 'Nazwa całego zagrania, np. „Silver Bullet”. Bez interwału.', 20
WHERE NOT EXISTS (SELECT 1 FROM "tag_categories" WHERE "key" = 'setup');--> statement-breakpoint

UPDATE "tag_categories" SET "sort_order" = 30 WHERE "key" = 'mistake';--> statement-breakpoint

-- 4. Klucz kategorii jest identyfikatorem wymiaru statystyk ("tag:<key>"), a
--    TagManager pozwalal zalozyc dwie kategorie o tej samej nazwie - czyli o
--    tym samym kluczu. Najpierw rozbrajamy ewentualne duplikaty, potem
--    domykamy unikatem, zeby to sie nie powtorzylo.
UPDATE "tag_categories" c
SET "key" = c."key" || '-' || c."id"
WHERE EXISTS (
  SELECT 1 FROM "tag_categories" d WHERE d."key" = c."key" AND d."id" < c."id"
);--> statement-breakpoint

CREATE UNIQUE INDEX "tag_categories_key_idx" ON "tag_categories" ("key");--> statement-breakpoint

-- 5. Ten sam tag kilka razy na jednym trade, po jednym wierszu na interwal.
--    Stary unikat (trade_id, tag_id) byl OSTRZEJSZY niz nowy, wiec istniejace
--    dane spelniaja nowy warunek z definicji - deduplikacja nie jest potrzebna.
--
--    NULLS NOT DISTINCT jest tu konieczne, nie kosmetyczne: bez niego wiersz z
--    pustym interwalem dalby sie wstawic dowolna liczbe razy i
--    onConflictDoNothing w saveTrade przestalby czegokolwiek pilnowac.
--
--    "id" dochodzi, bo tabela nie miala zadnego klucza glownego, a po tej
--    zmianie para (trade_id, tag_id) przestaje jednoznacznie wskazywac wiersz -
--    interfejs potrzebuje stabilnego klucza dla powtorzonego tagu.
ALTER TABLE "trade_tags" ADD COLUMN "id" serial;--> statement-breakpoint
DROP INDEX IF EXISTS "trade_tags_idx";--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_pk" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "trade_tags"
  ADD CONSTRAINT "trade_tags_uq" UNIQUE NULLS NOT DISTINCT ("trade_id", "tag_id", "interval");--> statement-breakpoint

-- 6. Zapisane widoki filtrujace po skasowanych tagach warunkow rynkowych.
--    Bez tego widok cicho zwracalby zero wierszy - EXISTS na nieistniejacym
--    tag_id nigdy nie jest prawdziwy, a nic w interfejsie by tego nie
--    wytlumaczylo. To jest blad, ktorego nikt nie zglosi jako bledu.
WITH przeliczone AS (
  SELECT v."id",
    (SELECT string_agg(u.x, ',' ORDER BY u.ord)
     FROM unnest(string_to_array(v."filters" ->> 'tag', ',')) WITH ORDINALITY AS u(x, ord)
     WHERE u.x ~ '^[0-9]+$'
       AND EXISTS (SELECT 1 FROM "tags" t WHERE t."id" = u.x::int)) AS lista
  FROM "saved_views" v
  WHERE v."filters" ? 'tag'
)
UPDATE "saved_views" v
SET "filters" = CASE
      WHEN p.lista IS NULL OR p.lista = '' THEN v."filters" - 'tag'
      ELSE jsonb_set(v."filters", '{tag}', to_jsonb(p.lista))
    END
FROM przeliczone p
WHERE p."id" = v."id";
