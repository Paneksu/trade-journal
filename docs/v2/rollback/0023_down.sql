-- Cofniecie migracji 0023_prop.sql. Uruchamiac w JEDNEJ transakcji (psql -1 -f).
--
-- !!! NISZCZY DANE: presety firm (takze te z 0024), reguly kont prop (prop_rules) i ksiege kosztow
-- i wyplat (prop_ledger). Ksiega kosztow nie ma odpowiednika gdzie indziej: bez zrzutu bazy
-- (pg_dump) tych wpisow nie odzyskasz. Kolejnosc: odwrotna do tworzenia (reguly wskazuja presety).
-- Jesli 0024 jest zaaplikowana, cofnij ja wczesniej (0024_down.sql), zeby wpis migratora zniknal.

DROP TABLE "prop_ledger";
DROP TABLE "prop_rules";
DROP TABLE "prop_firm_presets";

-- Zapomnij o migracji, zeby migrator mogl ja zastosowac ponownie (skrot liczony z pliku).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1787680000000;
