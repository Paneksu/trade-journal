import { czytajJson } from "@/lib/ingest/body";
import { blad, odpowiedz } from "@/lib/ingest/http";
import { zapiszOcene } from "@/lib/ingest/oceny";
import { OcenaSchema, opiszBledyZod } from "@/lib/ingest/schema";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/ingest/trades/:id/reviews  (application/json)
 * Ocena AI z regułami (kopia treści reguły + werdykt + dowód). Jedna ocena na
 * `basis` (chart | history): ponowne wysłanie podmienia, a zdanie użytkownika
 * o regule zostaje, jeśli werdykt AI się nie zmienił.
 */
export const POST = withIngest<Ctx>(async (request, { params }) => {
  const { id: idRaw } = await params;
  const tradeId = Number(idRaw);
  if (!Number.isInteger(tradeId) || tradeId < 1) {
    return blad(400, "bad_request", `id trade'a: »${idRaw}« - oczekiwano dodatniej liczby całkowitej.`);
  }

  const cialo = await czytajJson(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const ocena = OcenaSchema.safeParse(cialo.dane);
  if (!ocena.success) {
    const errors = opiszBledyZod(ocena.error, cialo.dane);
    return blad(400, "validation_failed", `Nieprawidłowa ocena: ${errors[0]}`, { errors });
  }

  const wynik = await zapiszOcene(tradeId, ocena.data);
  if (!wynik.ok) return blad(wynik.status, "not_found", wynik.error);
  return odpowiedz(wynik, wynik.created ? 201 : 200);
});
