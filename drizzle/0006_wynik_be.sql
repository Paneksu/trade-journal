-- Wynik BE - trzeci stan wyniku obok zysku i straty (ADR-011).
-- Prog liczony na liczbach calkowitych (tysieczne R, centy), zeby TS i SQL
-- nigdy nie dawaly innej odpowiedzi na tej samej granicy - patrz
-- lib/domain/outcome.ts i ADR-011.

ALTER TABLE "settings" ADD COLUMN "be_prog_r_mille" integer NOT NULL DEFAULT 100;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "be_prog_na_kontrakt" bigint NOT NULL DEFAULT 200;
