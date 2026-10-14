import { blad } from "@/lib/api-v2/http";
import { idZAdresu } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Slowa uzytkownika sa NIEZMIENNE (ADR-030). Ta trasa istnieje po to, zeby klient
 * dostal czytelne 409 z odeslaniem do aplikacji, a nie 405 bez wyjasnienia.
 * Poprawic slowa moze tylko uzytkownik w UI - powstaje wtedy nowy wiersz
 * (supersedes_id) z historia, a stary zostaje.
 */
async function odmow(_request: Request, api: { requestId: string }, ctx: Ctx): Promise<Response> {
  const id = idZAdresu((await ctx.params).id, "id słów użytkownika");
  if (!id.ok) return id.odpowiedz;
  return blad(
    409,
    "immutable",
    `Słowa użytkownika #${id.dane} są niezmienne i nie można ich poprawić przez API (tekst jest zapisany bajt w bajt razem ze skrótem SHA-256). Jeśli to pomyłka, użytkownik poprawia je w aplikacji: powstaje wtedy nowa wersja z odesłaniem do poprzedniej. AI może dopisać wyłącznie osobną interpretację: PUT /api/v2/user-words/${id.dane}/interpretation.`,
    { id: id.dane, requestId: api.requestId },
  );
}

export const PATCH = withApi<Ctx>({ scopes: ["write"] }, odmow);
export const PUT = withApi<Ctx>({ scopes: ["write"] }, odmow);
