import { DataSchema, DzienQuery, DzienZapisSchema } from "@/lib/api-v2/contract/v2";
import { odpowiedz, blad } from "@/lib/api-v2/http";
import { odczytajDzien, zapiszDzien } from "@/lib/api-v2/dni";
import { wczytajCialo, wczytajQuery } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

function dataZAdresu(surowa: string): { ok: true; data: string } | { ok: false; odpowiedz: Response } {
  const w = DataSchema.safeParse(surowa);
  if (!w.success) {
    return {
      ok: false,
      odpowiedz: blad(400, "bad_request", `data: »${surowa.slice(0, 20)}« - ${w.error.issues[0]?.message ?? "oczekiwano YYYY-MM-DD"}.`),
    };
  }
  return { ok: true, data: w.data };
}

/** GET /api/v2/days/2026-10-14?accountId=1|sessionId=3: notatka dnia, trade'y, slowa uzytkownika i notatki przypiete do dnia. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (request, _api, { params }) => {
  const d = dataZAdresu((await params).date);
  if (!d.ok) return d.odpowiedz;
  const q = wczytajQuery(request, DzienQuery);
  if (!q.ok) return q.odpowiedz;
  return odpowiedz(await odczytajDzien(d.data, q.dane));
});

/**
 * PUT /api/v2/days/2026-10-14: zapis notatki dnia (nadpisuje tylko podane pola).
 * Konto albo sesja backtestu w ciele. Dzien z trade'ami nie moze byc dniem bez transakcji.
 */
export const PUT = withApi<Ctx>({ scopes: ["write"] }, async (request, _api, { params }) => {
  const d = dataZAdresu((await params).date);
  if (!d.ok) return d.odpowiedz;
  const w = await wczytajCialo(request, DzienZapisSchema, "Nieprawidłowy zapis dnia");
  if (!w.ok) return w.odpowiedz;

  const wynik = await zapiszDzien(d.data, w.dane);
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ id: wynik.id, date: d.data, created: wynik.utworzono }, wynik.utworzono ? 201 : 200);
});
