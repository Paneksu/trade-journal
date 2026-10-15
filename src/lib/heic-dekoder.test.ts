import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Wynik »dekodera«: to, co zwroci decode() dla pierwszego obrazu (inne niz deklarowal plik). */
let zdekodowane = { width: 10, height: 10 };
vi.mock("heic-decode", () => {
  const all = async () => {
    const obrazy = [
      {
        width: 10,
        height: 10,
        decode: async () => ({ ...zdekodowane, data: new Uint8ClampedArray(4) }),
      },
    ] as unknown as { dispose: () => void };
    obrazy.dispose = () => {};
    return obrazy;
  };
  return { default: Object.assign(async () => ({}), { all }) };
});

import { dekodujHeic, LIMIT_PIKSELI_HEIC, wymiaryHeic } from "./heic";

const PROBKA = readFileSync(path.resolve(__dirname, "api-v2/test/probka.heic"));

describe("dekodujHeic po dekodowaniu porownuje wynik z limitem i z ispe (audyt N2, 15.10.2026)", () => {
  beforeEach(() => {
    zdekodowane = { width: 10, height: 10 };
  });

  it("wynik wiekszy niz limit pikseli = odrzucenie, nawet gdy naglowek zapowiadal malo", async () => {
    zdekodowane = { width: 20000, height: 20000 };
    expect(20000 * 20000).toBeGreaterThan(LIMIT_PIKSELI_HEIC);
    await expect(dekodujHeic(Buffer.from(PROBKA))).rejects.toThrow(/Po rozpakowaniu.*limit/);
  });

  it("wynik wiekszy niz deklarowane w ispe (a mniejszy niz limit) = odrzucenie", async () => {
    const deklarowane = wymiaryHeic(PROBKA)!;
    zdekodowane = { width: deklarowane.width + 1, height: deklarowane.height + 1 };
    await expect(dekodujHeic(Buffer.from(PROBKA))).rejects.toThrow(/ispe/);
  });

  it("wynik zgodny z deklaracja przechodzi", async () => {
    const deklarowane = wymiaryHeic(PROBKA)!;
    zdekodowane = { width: deklarowane.width, height: deklarowane.height };
    const w = await dekodujHeic(Buffer.from(PROBKA));
    expect(w.width).toBe(deklarowane.width);
  });
});
