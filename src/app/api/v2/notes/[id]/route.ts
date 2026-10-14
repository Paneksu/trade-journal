import { NotatkaZmienSchema } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { rewizjaZIfMatch, szczegolyNotatki, zmienNotatke, zNotatki } from "@/lib/api-v2/notatki";
import { idZAdresu, wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v2/notes/:id: notatka z trescia, rewizja (rev i ETag), linkami i backlinkami. */
export const GET = withApi<Ctx>({ scopes: ["read"] }, async (_request, _api, { params }) => {
  const id = idZAdresu((await params).id, "id notatki");
  if (!id.ok) return id.odpowiedz;
  const n = await szczegolyNotatki(db, id.dane);
  if (!n) return blad(404, "not_found", `Notatka #${id.dane} nie istnieje.`);
  return odpowiedz(n, 200, { ETag: `"${n.rev}"` });
});

/**
 * PATCH /api/v2/notes/:id z naglowkiem If-Match: <rev>. Nieaktualny rev = 409 z biezaca trescia
 * (ADR-029). Kasowania w API nie ma (ADR-032): archived=true odklada notatke do archiwum.
 */
export const PATCH = withApi<Ctx>({ scopes: ["write"] }, async (request, api, { params }) => {
  const id = idZAdresu((await params).id, "id notatki");
  if (!id.ok) return id.odpowiedz;

  const surowy = request.headers.get("if-match");
  if (surowy === null) {
    return blad(
      428,
      "precondition_required",
      "Brak nagłówka If-Match. Zmiana notatki wymaga numeru rewizji z ostatniego odczytu (If-Match: <rev>), żeby dwa urządzenia nie nadpisały się po cichu.",
    );
  }
  const ifMatch = rewizjaZIfMatch(surowy);
  if (ifMatch === null) {
    return blad(400, "bad_request", `If-Match: »${surowy.slice(0, 40)}« - oczekiwano numeru rewizji, np. If-Match: 3 (gwiazdka nie jest obsługiwana).`);
  }

  const w = await wczytajCialo(request, NotatkaZmienSchema, "Nieprawidłowa zmiana notatki");
  if (!w.ok) return w.odpowiedz;

  const wynik = await api.zapis((tx) => zmienNotatke(tx, id.dane, ifMatch, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(zNotatki(wynik.notatka), 200, { ETag: `"${wynik.notatka.rev}"` });
});
