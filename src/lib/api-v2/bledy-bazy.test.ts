import { describe, expect, it } from "vitest";

import { opiszBladBazy } from "./bledy-bazy";

describe("TJ422 ma dwa znaczenia i dwa kody odpowiedzi", () => {
  it("rule_versions = prog n (below_threshold)", () => {
    expect(opiszBladBazy({ code: "TJ422", table_name: "rule_versions" })).toMatchObject({ status: 422, kod: "below_threshold" });
  });

  it.each(["trade_plans", "trade_reviews", "weekly_reviews", undefined])("tabela %s = niespojne dane (inconsistent_data)", (tabela) => {
    const o = opiszBladBazy({ code: "TJ422", table_name: tabela });
    expect(o).toMatchObject({ status: 422, kod: "inconsistent_data" });
    expect(o?.komunikat).not.toContain("hipotez");
  });

  it("inne kody bez zmian", () => {
    expect(opiszBladBazy({ code: "TJ409" })?.kod).toBe("immutable");
    expect(opiszBladBazy({ code: "TJ403" })?.kod).toBe("approval_forbidden");
    expect(opiszBladBazy(new Error("zwykly"))).toBeNull();
  });
});
