import { describe, expect, it } from "vitest";

import { czyPominiety, czyStatus, maWynik, STATUSY } from "./status";

describe("czyStatus", () => {
  it("akceptuje kazda wartosc z STATUSY", () => {
    for (const s of STATUSY) expect(czyStatus(s)).toBe(true);
  });

  it("odrzuca smieci z formularza", () => {
    expect(czyStatus("cos-innego")).toBe(false);
    expect(czyStatus("")).toBe(false);
    expect(czyStatus(undefined)).toBe(false);
    expect(czyStatus(null)).toBe(false);
    expect(czyStatus(123)).toBe(false);
  });
});

describe("maWynik", () => {
  it("prawda dla closed i missed", () => {
    expect(maWynik("closed")).toBe(true);
    expect(maWynik("missed")).toBe(true);
  });

  it("falsz dla planned, open i cancelled", () => {
    expect(maWynik("planned")).toBe(false);
    expect(maWynik("open")).toBe(false);
    expect(maWynik("cancelled")).toBe(false);
  });
});

describe("czyPominiety", () => {
  it("prawda tylko dla missed", () => {
    expect(czyPominiety("missed")).toBe(true);
    expect(czyPominiety("closed")).toBe(false);
    expect(czyPominiety("open")).toBe(false);
    expect(czyPominiety("planned")).toBe(false);
    expect(czyPominiety("cancelled")).toBe(false);
  });
});
