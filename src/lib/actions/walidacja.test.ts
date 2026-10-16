import { describe, expect, it } from "vitest";

import { PropKsiegaWpisSchema, PropRegulyUtworzSchema } from "@/lib/api-v2/contract/funkcje";

import { bladWalidacji, tekstUzytkownika } from "./walidacja";

/* Audyt fazy 5, pkt 5: akcje serwera walidują tym samym, co API. Pomocnik tekstów i granice z kontraktu. */
describe("walidacja akcji UI", () => {
  it("tekstUzytkownika: NUL, samotny surogat i za dużo bajtów to błąd; zwykły polski tekst przechodzi", () => {
    const t = tekstUzytkownika(10);
    expect(t.safeParse("zażółć").success).toBe(true);
    const nul = t.safeParse("a\u0000b");
    expect(nul.success).toBe(false);
    expect(bladWalidacji(nul.error!, { "": "Notatka" })).toMatch(/^Notatka: znak NUL/);
    expect(t.safeParse("\ud800").success).toBe(false);
    // 6 znaków „ż” = 12 bajtów UTF-8 > 10.
    expect(t.safeParse("żżżżżż").success).toBe(false);
  });

  it("księga: kwota ponad ±10 mln USD odrzucona; reguły prop: źródło tylko https, zakres consistency", () => {
    expect(PropKsiegaWpisSchema.safeParse({ kind: "eval_fee", amountCents: -1_000_000_001, occurredOn: "2026-10-01" }).success).toBe(false);
    expect(PropKsiegaWpisSchema.safeParse({ kind: "eval_fee", amountCents: -16_700, occurredOn: "2026-10-01" }).success).toBe(true);
    const baza = { validFrom: "2026-10-01", ddType: "eod", maxDdCents: 200_000 };
    expect(PropRegulyUtworzSchema.safeParse({ ...baza, sourceUrl: "http://firma.pl" }).success).toBe(false);
    expect(PropRegulyUtworzSchema.safeParse({ ...baza, sourceUrl: "https://firma.pl" }).success).toBe(true);
    expect(PropRegulyUtworzSchema.safeParse({ ...baza, consistencyPct: 150 }).success).toBe(false);
  });
});
