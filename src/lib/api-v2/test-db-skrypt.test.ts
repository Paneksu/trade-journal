import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * `npm run test:db` używa WSPÓLNEGO bezpiecznika produkcji agencji (ścieżka
 * absolutna) i nie da się go obejść flagą --produkcja. Test uruchamia skrypt
 * z adresem nielokalnym: bezpiecznik kończy proces kodem 3 (własny kod odmowy
 * skryptu to 2), zanim cokolwiek zostanie połączone.
 */
const SKRYPT = path.resolve(__dirname, "../../../scripts/test-db.mjs");
const uruchom = (url: string, ...argumenty: string[]) =>
  spawnSync(process.execPath, [SKRYPT, ...argumenty], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    timeout: 20_000,
  });

describe("scripts/test-db.mjs: wspólny bezpiecznik produkcji", () => {
  it("odmawia bazy spoza tej maszyny kodem 3 z bezpiecznika i nazwą hosta w komunikacie", () => {
    const w = uruchom("postgresql://u:p@db.produkcja.example.com:5432/tj_cokolwiek");
    expect(w.status).toBe(3);
    expect(w.stderr).toContain("[bezpiecznik-produkcji]");
    expect(w.stderr).toContain("db.produkcja.example.com");
  });

  it("flaga --produkcja nie otwiera drogi do zdalnej bazy", () => {
    const w = uruchom("postgresql://u:p@db.produkcja.example.com:5432/tj_cokolwiek", "--produkcja");
    expect(w.status).toBe(3);
    expect(w.stderr).toContain("ODMOWA");
    expect(w.stderr).not.toContain("Kontynuuję świadomie");
  });

  it("lokalny host, ale baza bez prefiksu tj_ (np. dev `journal`) też jest odrzucona", () => {
    const w = uruchom("postgresql://u:p@127.0.0.1:55433/journal");
    expect(w.status).toBe(2);
    expect(w.stderr).toContain("tj_");
  });

  it("pusty DATABASE_URL = odmowa (fail closed)", () => {
    const w = uruchom("");
    expect(w.status).toBe(2);
  });
});
