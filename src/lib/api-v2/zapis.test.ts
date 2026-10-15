import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const wywolania: string[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      wywolania.push("transaction");
      return fn({ execute: async () => [] });
    },
  },
}));

describe("zapisZAktorem nie przyjmuje aktora »ui« (audyt 6)", () => {
  it.each(["ui", "UI", " ui ", "Ui"])("odrzuca %j, zanim otworzy transakcje", async (aktor) => {
    const { zapisZAktorem } = await import("./zapis");
    wywolania.length = 0;
    expect(() => zapisZAktorem(aktor, async () => 1)).toThrow(/zapisJakoUi/);
    expect(wywolania).toEqual([]);
  });

  it("przepuszcza aktorow API i ingest, a zapisJakoUi dziala dla modulow decyzji", async () => {
    const { zapisZAktorem, zapisJakoUi } = await import("./zapis");
    expect(await zapisZAktorem("api:7", async () => "api")).toBe("api");
    expect(await zapisZAktorem("ingest", async () => "ingest")).toBe("ingest");
    expect(await zapisJakoUi(async () => "ui")).toBe("ui");
  });
});
