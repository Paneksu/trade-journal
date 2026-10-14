/**
 * Kanoniczny JSON do skrotow dowodow (`trade_reviews.evidence_hash`) i wariantow
 * (`hypothesis_variants.params_hash`, ADR-033). Ten sam obiekt zawsze daje ten sam
 * tekst, niezaleznie od kolejnosci kluczy: klucze obiektow sortowane po punktach
 * kodowych, tablice w podanej kolejnosci, brak spacji. Sam skrot (SHA-256) liczy
 * warstwa API, bo modul domeny nie importuje `node:crypto`.
 *
 * Wartosci, ktorych JSON nie opisuje jednoznacznie (undefined, NaN, Infinity,
 * funkcje, bigint), to blad - zamiast cichego `null`, ktory pozwolilby dwom
 * roznym wejsciom dac ten sam skrot.
 */

export class BladKanonicznegoJson extends Error {
  constructor(sciezka: string, powod: string) {
    super(`kanoniczny JSON: ${sciezka || "(korzen)"} - ${powod}`);
    this.name = "BladKanonicznegoJson";
  }
}

function pisz(w: unknown, sciezka: string): string {
  if (w === null) return "null";
  switch (typeof w) {
    case "string":
      return JSON.stringify(w);
    case "boolean":
      return w ? "true" : "false";
    case "number":
      if (!Number.isFinite(w)) throw new BladKanonicznegoJson(sciezka, `liczba ${String(w)} nie ma zapisu w JSON`);
      // -0 i 0 to ta sama wartosc dla skrotu.
      return Object.is(w, -0) ? "0" : JSON.stringify(w);
    case "object": {
      if (Array.isArray(w)) {
        return `[${w.map((x, i) => pisz(x, `${sciezka}[${i}]`)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(w);
      if (proto !== Object.prototype && proto !== null) {
        throw new BladKanonicznegoJson(sciezka, "dozwolone są tylko zwykłe obiekty, tablice i wartości proste");
      }
      const o = w as Record<string, unknown>;
      const klucze = Object.keys(o).sort();
      const czesci: string[] = [];
      for (const k of klucze) {
        if (o[k] === undefined) throw new BladKanonicznegoJson(`${sciezka}.${k}`, "wartość undefined (usuń pole albo podaj null)");
        czesci.push(`${JSON.stringify(k)}:${pisz(o[k], `${sciezka}.${k}`)}`);
      }
      return `{${czesci.join(",")}}`;
    }
    default:
      throw new BladKanonicznegoJson(sciezka, `typ ${typeof w} nie ma zapisu w JSON`);
  }
}

export function kanonicznyJson(wartosc: unknown): string {
  return pisz(wartosc, "");
}
