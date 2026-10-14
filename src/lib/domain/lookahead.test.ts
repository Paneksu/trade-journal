import { describe, expect, it } from "vitest";

import { moglZnacDzien } from "./lookahead";

describe("moglZnacDzien", () => {
  it("dzien przed odcieciem: mogl znac; po odcieciu: nie", () => {
    expect(moglZnacDzien("claude-opus-5-5", "2023-03-14").moglZnacDzien).toBe(true);
    expect(moglZnacDzien("claude-opus-5-5", "2026-06-30").moglZnacDzien).toBe(true);
    expect(moglZnacDzien("claude-opus-5-5", "2026-07-01").moglZnacDzien).toBe(false);
  });

  it("starszy model ma wczesniejsze odciecie", () => {
    expect(moglZnacDzien("claude-sonnet-4-20250514", "2025-06-01").moglZnacDzien).toBe(false);
    expect(moglZnacDzien("claude-sonnet-4-20250514", "2025-01-01").moglZnacDzien).toBe(true);
  });

  it("brak modelu albo nieznany model = mogl znac, z powodem w tekscie", () => {
    expect(moglZnacDzien(null, "2030-01-01")).toMatchObject({ moglZnacDzien: true });
    expect(moglZnacDzien("", "2030-01-01").powod).toContain("model nieznany");
    const nieznany = moglZnacDzien("gpt-x", "2030-01-01");
    expect(nieznany.moglZnacDzien).toBe(true);
    expect(nieznany.powod).toContain("gpt-x");
  });
});
