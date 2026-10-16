import { KontaDniaZapisSchema } from "@/lib/api-v2/contract/broker";
import { DataSchema } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { odczytajKontaDnia, zapiszKontaDnia } from "@/lib/api-v2/konta-dnia";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

function dataZAdresu(surowa: string): { ok: true; data: string } | { ok: false; odpowiedz: Response } {
  const w = DataSchema.safeParse(surowa);
  if (!w.success) return { ok: false, odpowiedz: blad(400, "bad_request", `data: »${surowa.slice(0, 20)}« - ${w.error.issues[0]?.message ?? "oczekiwano YYYY-MM-DD"}.`) };
  return { ok: true, data: w.data };
}

/** GET /api/v2/days/2026-10-14/accounts: aktywne konta dnia (rytual przed sesja) z kategoria, firma, program i faza. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const d = dataZAdresu((await params).date);
  if (!d.ok) return d.odpowiedz;
  return odpowiedz(await odczytajKontaDnia(db, d.data));
});

/** PUT /api/v2/days/2026-10-14/accounts { accountIds: [3, 5] }: ustala konta dnia (wielokrotne); puste czysci wybor. */
export const PUT = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const d = dataZAdresu((await params).date);
  if (!d.ok) return d.odpowiedz;
  const w = await wczytajCialo(request, KontaDniaZapisSchema, "Nieprawidłowe konta dnia");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszKontaDnia(tx, d.data, w.dane.accountIds));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  return odpowiedz({ day: wynik.day, accounts: wynik.accounts });
});
