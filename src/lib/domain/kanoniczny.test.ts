import { describe, expect, it } from "vitest";

import { BladKanonicznegoJson, kanonicznyJson } from "./kanoniczny";

describe("kanonicznyJson", () => {
  it("kolejnosc kluczy nie wplywa na wynik, na kazdym poziomie", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "x" } };
    const b = { a: { c: "x", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(kanonicznyJson(a)).toBe(kanonicznyJson(b));
    expect(kanonicznyJson(a)).toBe('{"a":{"c":"x","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("kolejnosc w tablicy ma znaczenie", () => {
    expect(kanonicznyJson([1, 2])).not.toBe(kanonicznyJson([2, 1]));
  });

  it("polskie znaki i emoji zostaja, cudzyslow jest ucieczkowany", () => {
    expect(kanonicznyJson({ t: 'zażółć "gęślą" 🙂' })).toBe('{"t":"zażółć \\"gęślą\\" 🙂"}');
  });

  it("-0 i 0 to to samo; null zostaje nullem", () => {
    expect(kanonicznyJson({ a: -0, b: null })).toBe('{"a":0,"b":null}');
  });

  it("odrzuca undefined, NaN, Infinity, bigint i funkcje z wskazaniem sciezki", () => {
    expect(() => kanonicznyJson({ a: { b: undefined } })).toThrow(/\.a\.b - wartość undefined/);
    expect(() => kanonicznyJson([1, Number.NaN])).toThrow(/\[1\] - liczba NaN/);
    expect(() => kanonicznyJson({ x: Number.POSITIVE_INFINITY })).toThrow(BladKanonicznegoJson);
    expect(() => kanonicznyJson({ x: BigInt(1) })).toThrow(/typ bigint/);
    expect(() => kanonicznyJson({ x: () => 1 })).toThrow(/typ function/);
  });

  it("odrzuca obiekty niebedace zwyklymi (Date, Map), zeby nie tracic ich po cichu", () => {
    expect(() => kanonicznyJson({ d: new Date() })).toThrow(/zwykłe obiekty/);
    expect(() => kanonicznyJson(new Map())).toThrow(/zwykłe obiekty/);
  });

  it("rozne wejscia daja rozne teksty (brak kolizji liczba/napis)", () => {
    expect(kanonicznyJson({ a: 1 })).not.toBe(kanonicznyJson({ a: "1" }));
    expect(kanonicznyJson({ a: true })).not.toBe(kanonicznyJson({ a: "true" }));
  });
});
