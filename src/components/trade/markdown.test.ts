import { describe, expect, it } from "vitest";

import { bezpiecznyAdres } from "./markdown";

/* Code review fazy 5 (16.10.2026): `//host` i `/\host` to adres na obcą domenę, nie ścieżka względna. */
describe("bezpiecznyAdres (linki w markdownie)", () => {
  it("przepuszcza http(s), ścieżki od / i kotwice", () => {
    for (const u of ["https://dziennik.panekweb.pl/x", "http://a.pl", "/trades/1", "/", "#sekcja"]) expect(bezpiecznyAdres(u)).toBe(u);
  });
  it("odrzuca adresy bez protokołu i obce protokoły", () => {
    for (const u of ["//zly.pl/x", "/\\zly.pl", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.pl", "https:zly.pl"]) expect(bezpiecznyAdres(u)).toBe("");
  });
});
