import { czytajJson } from "@/lib/ingest/body";
import { blad, odpowiedz } from "@/lib/ingest/http";
import { opiszBledyZod, SesjaSchema } from "@/lib/ingest/schema";
import { znajdzLubUtworzSesje } from "@/lib/ingest/sesje";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/backtest-sessions
 * Tworzy sesję albo odnajduje ją po externalRef (fxr:<id>). Idempotentne:
 * 201 dla nowej, 200 dla istniejącej (niczego w niej nie zmienia).
 */
export const POST = withIngest(async (request) => {
  const cialo = await czytajJson(request);
  if (!cialo.ok) {
    return blad(cialo.status, cialo.status === 413 ? "payload_too_large" : "bad_request", cialo.error);
  }

  const sesja = SesjaSchema.safeParse(cialo.dane);
  if (!sesja.success) {
    const errors = opiszBledyZod(sesja.error, cialo.dane);
    return blad(400, "validation_failed", `Nieprawidłowa sesja: ${errors[0]}`, { errors });
  }

  const wynik = await znajdzLubUtworzSesje(sesja.data);
  if (!wynik.ok) return blad(wynik.status, "validation_failed", wynik.error);
  return odpowiedz(
    {
      id: wynik.id,
      created: wynik.created,
      kind: wynik.session.kind,
      externalRef: wynik.session.externalRef,
      name: wynik.session.name,
      warnings: wynik.warnings,
    },
    wynik.created ? 201 : 200,
  );
});
