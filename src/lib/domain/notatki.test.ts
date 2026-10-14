import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { skrotTekstu } from "@/lib/api-v2/skrot";
import { slugZNumerem, slugZTytulu, sprawdzTekstBajtWBajt, wyciagnijLinki } from "./notatki";

describe("slugZTytulu", () => {
  it("zdejmuje polskie ogonki, w tym ł, którego NFD nie rozkłada", () => {
    expect(slugZTytulu("Zarządzanie ryzykiem")).toBe("zarzadzanie-ryzykiem");
    expect(slugZTytulu("Łódź, żółć i gęślą jaźń")).toBe("lodz-zolc-i-gesla-jazn");
  });

  it("zwija znaki specjalne i obcina myślniki z brzegów", () => {
    expect(slugZTytulu("  --FVG @ 5m!!  ")).toBe("fvg-5m");
    expect(slugZTytulu("R-007: nie wchodzę po 11:00")).toBe("r-007-nie-wchodze-po-11-00");
  });

  it("tytuł bez liter i cyfr daje pusty slug (wołający dobiera zastępczy)", () => {
    expect(slugZTytulu("???")).toBe("");
    expect(slugZTytulu("😀😀")).toBe("");
  });

  it("mieści się w 120 znakach i nie kończy się myślnikiem", () => {
    const s = slugZTytulu(`${"a".repeat(118)} bbb ccc`);
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s).not.toMatch(/-$/);
    expect(s).toMatch(/^[a-z0-9][a-z0-9-]{0,119}$/);
  });

  it("slugZNumerem dokleja numer i zachowuje limit", () => {
    expect(slugZNumerem("plan", 2)).toBe("plan-2");
    const dlugi = slugZNumerem("a".repeat(120), 12);
    expect(dlugi.length).toBeLessThanOrEqual(120);
    expect(dlugi.endsWith("-12")).toBe(true);
  });
});

describe("wyciagnijLinki", () => {
  it("wyciąga [[Tytuł]], pomija alias i fragment, zachowuje kolejność", () => {
    const md = "Patrz [[Zarządzanie ryzykiem]] i [[FVG|luka]], także [[Sesje#Londyn]].";
    expect(wyciagnijLinki(md)).toEqual(["Zarządzanie ryzykiem", "FVG", "Sesje"]);
  });

  it("nie dubluje celów bez względu na wielkość liter", () => {
    expect(wyciagnijLinki("[[FVG]] [[fvg]] [[FVG|inny alias]]")).toEqual(["FVG"]);
  });

  it("pomija linki w blokach kodu, tak jak Obsidian", () => {
    const md = "```\n[[w bloku]]\n```\n`[[w linii]]` oraz [[prawdziwy]]";
    expect(wyciagnijLinki(md)).toEqual(["prawdziwy"]);
  });

  it("ignoruje puste i wielowierszowe nawiasy", () => {
    expect(wyciagnijLinki("[[]] [[ ]] [[a\nb]]")).toEqual([]);
  });
});

describe("skrotTekstu i sprawdzTekstBajtWBajt", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

  it("skrót liczy się z bajtów UTF-8 bez normalizacji i bez zamiany końców linii", () => {
    const nfc = "Zażółć gęślą jaźń";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(skrotTekstu(nfc)).toBe(sha(Buffer.from(nfc, "utf8")));
    expect(skrotTekstu(nfd)).toBe(sha(Buffer.from(nfd, "utf8")));
    expect(skrotTekstu(nfc)).not.toBe(skrotTekstu(nfd));
    expect(skrotTekstu("a\r\nb")).not.toBe(skrotTekstu("a\nb"));
  });

  it("akceptuje polskie znaki, emoji, CRLF i spacje na brzegach", () => {
    expect(sprawdzTekstBajtWBajt("  Wszedłem, bo sweep 🔥\r\nSL pod low.\n  ")).toEqual({ ok: true });
  });

  it("odrzuca NUL z pozycją", () => {
    const w = sprawdzTekstBajtWBajt("ab\u0000cd");
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.powod).toContain("pozycji 2");
  });

  it("odrzuca samotny surogat (nie ma dla niego kodu UTF-8), przepuszcza poprawną parę", () => {
    const zly = sprawdzTekstBajtWBajt("x\ud800y");
    expect(zly.ok).toBe(false);
    if (!zly.ok) expect(zly.powod).toContain("pozycji 1");
    expect(sprawdzTekstBajtWBajt("x😀y")).toEqual({ ok: true });
  });
});
