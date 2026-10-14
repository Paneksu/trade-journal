import { PrzegladTygodniaZapisSchema } from "@/lib/api-v2/contract/funkcje";
import { DataSchema } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { zapiszPrzeglad, zPrzegladu } from "@/lib/api-v2/przeglady";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ weekStart: string }> };

/**
 * PUT /api/v2/reviews/weekly/2026-10-12: zapis SZKICU przegladu tygodnia (draftMd z migawka liczb,
 * wnioski i zobowiazanie jako slowa uzytkownika, rozliczenie poprzedniego). JEDNO zobowiazanie
 * na tydzien: drugie, inne, to 409. Zatwierdza przeglad wylacznie uzytkownik w aplikacji.
 */
export const PUT = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const surowa = (await params).weekStart;
  const d = DataSchema.safeParse(surowa);
  if (!d.success) return blad(400, "bad_request", "weekStart: »" + surowa.slice(0, 20) + "« - " + (d.error.issues[0]?.message ?? "oczekiwano YYYY-MM-DD") + ".");
  const w = await wczytajCialo(request, PrzegladTygodniaZapisSchema, "Nieprawidłowy przegląd tygodnia");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zapiszPrzeglad(tx, d.data, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz({ created: wynik.utworzony, review: await zPrzegladu(db, wynik.przeglad) }, wynik.utworzony ? 201 : 200);
});
