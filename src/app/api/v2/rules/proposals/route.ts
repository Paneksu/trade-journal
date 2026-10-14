import { PropozycjaReguly } from "@/lib/api-v2/contract/v2";
import { blad, odpowiedz } from "@/lib/api-v2/http";
import { zaproponujRegule } from "@/lib/api-v2/reguly";
import { wczytajCialo } from "@/lib/api-v2/walidacja";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/rules/proposals: propozycja reguly albo nowej wersji (zakres propose).
 *
 * To JEDYNA trasa v2 dotykajaca wersji regul i nie ma wariantu zatwierdzajacego:
 * zatwierdzic lub odrzucic moze wylacznie uzytkownik w aplikacji (ADR-030). Trzy
 * warstwy pilnuja tego niezaleznie: brak zakresu "approve" (CHECK w bazie), brak
 * trasy (test-straznik czyta zrodla) i trigger tj_require_ui_actor w bazie.
 */
export const POST = withApi({ scopes: ["propose"] }, async (request, api) => {
  const w = await wczytajCialo(request, PropozycjaReguly, "Nieprawidłowa propozycja reguły");
  if (!w.ok) return w.odpowiedz;

  const wynik = await api.zapis((tx) => zaproponujRegule(tx, api, w.dane));
  if (!wynik.ok) return blad(wynik.status, wynik.kod, wynik.komunikat, wynik.dodatkowe ?? {});
  return odpowiedz(
    {
      rule: wynik.kodReguly,
      version: wynik.wersja,
      status: wynik.status,
      noteId: wynik.noteId,
      created: wynik.utworzona,
      n: wynik.n,
      signature: wynik.podpis,
      note:
        wynik.status === "proposed"
          ? "To tylko propozycja. Zatwierdza ją użytkownik w aplikacji, po jednej naraz."
          : `Taka treść już istnieje jako wersja o statusie »${wynik.status}«; nic nie zgłoszono.`,
    },
    wynik.utworzona ? 201 : 200,
  );
});
