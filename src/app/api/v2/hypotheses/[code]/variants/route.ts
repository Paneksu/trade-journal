import { WariantUtworzSchema } from "@/lib/api-v2/contract/funkcje";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { podsumowanieWariantow, zarejestrujWariant, zWariantu } from "@/lib/api-v2/warianty";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const KOD = /^H-\d{3,}$/;

/** GET /api/v2/hypotheses/:code/variants: warianty, ich licznik i ostrzezenie o zawyzeniu najlepszego wyniku. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const code = (await params).code;
  if (!KOD.test(code)) return blad(400, "bad_request", "kod hipotezy: »" + code.slice(0, 20) + "« - oczekiwano np. H-001.");
  const w = await podsumowanieWariantow(db, code);
  if (!w) return blad(404, "not_found", "Hipoteza »" + code + "« nie istnieje (lista: GET /api/v2/hypotheses).");
  return odpowiedz(w);
});

/**
 * POST /api/v2/hypotheses/:code/variants: rejestruje testowany wariant (SL, TP, okno godzinowe). Licznik
 * prob rosnie tylko dla NOWEGO zestawu parametrow; ten sam zestaw to ten sam wariant (200).
 */
export const POST = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const code = (await params).code;
  if (!KOD.test(code)) return blad(400, "bad_request", "kod hipotezy: »" + code.slice(0, 20) + "« - oczekiwano np. H-001.");
  const w = await wczytajCialo(request, WariantUtworzSchema, "Nieprawidłowy wariant");
  if (!w.ok) return w.odpowiedz;
  const wynik = await api.zapis((tx) => zarejestrujWariant(tx, code, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat);
  const podsumowanie = await podsumowanieWariantow(db, code);
  return odpowiedz({ created: wynik.utworzony, variant: zWariantu(wynik.wariant), count: podsumowanie?.count ?? 0, warning: podsumowanie?.warning ?? null }, wynik.utworzony ? 201 : 200);
});
