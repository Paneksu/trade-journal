import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dekodujHeic, wymiaryHeic } from "./heic";

const PROBKA = readFileSync(path.resolve(__dirname, "api-v2/test/probka.heic"));

/** Pozycje wszystkich czterobajtowych wystapien napisu w buforze. */
function znajdz(b: Uint8Array, napis: string): number[] {
  const wynik: number[] = [];
  const wz = Buffer.from(napis, "latin1");
  for (let i = 0; i + wz.length <= b.length; i += 1) if (Buffer.compare(Buffer.from(b.subarray(i, i + wz.length)), wz) === 0) wynik.push(i);
  return wynik;
}

describe("wymiaryHeic czyta ispe tylko z meta > iprp > ipco (review 15.10.2026)", () => {
  it("probka: wymiary z metadanych sa dodatnie i zgodne z dekoderem", async () => {
    const w = wymiaryHeic(PROBKA);
    expect(w).not.toBeNull();
    const d = await dekodujHeic(Buffer.from(PROBKA));
    expect(d.width * d.height).toBeLessThanOrEqual(w!.width * w!.height);
  });

  it("»ispe« podrzucone w danych poza meta (np. doklejone na koncu pliku) jest ignorowane", () => {
    const baza = wymiaryHeic(PROBKA);
    const falsz = Buffer.alloc(24);
    falsz.writeUInt32BE(24, 0);
    falsz.write("ispe", 4, "latin1");
    falsz.writeUInt32BE(20000, 12);
    falsz.writeUInt32BE(20000, 16);
    const z = Buffer.concat([Buffer.from(PROBKA), falsz]);
    expect(wymiaryHeic(z)).toEqual(baza);
  });

  it("»ispe« wewnatrz meta > iprp > ipco jest brane pod uwage (podmiana wymiarow w prawdziwym pudelku)", () => {
    const kopia = Buffer.from(PROBKA);
    const miejsca = znajdz(kopia, "ispe");
    expect(miejsca.length).toBeGreaterThan(0);
    for (const m of miejsca) {
      kopia.writeUInt32BE(20000, m + 8);
      kopia.writeUInt32BE(20000, m + 12);
    }
    expect(wymiaryHeic(kopia)).toEqual({ width: 20000, height: 20000 });
  });

  it("uciety albo bezsensowny plik nie rzuca wyjatku i daje null", () => {
    expect(wymiaryHeic(new Uint8Array(0))).toBeNull();
    expect(wymiaryHeic(Buffer.from("00000008meta", "latin1"))).toBeNull();
    expect(wymiaryHeic(PROBKA.subarray(0, 40))).toBeNull();
  });
});
