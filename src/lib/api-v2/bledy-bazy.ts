/**
 * Tlumaczenie bledow Postgresa na odpowiedzi HTTP (model-danych 6 i 8, pkt 11).
 * Triggery niezmiennosci rzucaja wlasne SQLSTATE, zeby API nie parsowalo
 * komunikatu: `TJ409` = proba zmiany czegos niezmiennego, `TJ403` = proba
 * zatwierdzenia przez aktora, ktory nie jest sesja UI, `TJ422` = prog n hipotezy. Uzytkownik nigdy nie
 * widzi surowego komunikatu Postgresa - ten trafia tylko do logow.
 */

export type BladBazy = { code?: string; message?: string; constraint_name?: string; detail?: string; table_name?: string };

/** Wyciaga blad Postgresa z wyjatku drizzle (`DrizzleQueryError.cause`) albo z surowego bledu postgres.js. */
export function bladBazy(e: unknown): BladBazy | null {
  let x: unknown = e;
  for (let i = 0; i < 4 && x !== null && typeof x === "object"; i += 1) {
    const o = x as { code?: unknown; cause?: unknown };
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) return x as BladBazy;
    x = o.cause;
  }
  return null;
}

export function kodBleduBazy(e: unknown): string | undefined {
  return bladBazy(e)?.code;
}

export type OdpowiedzBledu = { status: number; kod: string; komunikat: string };

/** `null` = to nie jest blad, ktory umiemy opisac (wtedy 500 z identyfikatorem w logach). */
export function opiszBladBazy(e: unknown): OdpowiedzBledu | null {
  const b = bladBazy(e);
  if (!b) return null;
  switch (b.code) {
    case "TJ409":
      return {
        status: 409,
        kod: "immutable",
        komunikat:
          "Ta treść jest niezmienna i nie można jej poprawić przez API. Słowa użytkownika, zatwierdzone wersje i dopiski poprawia się wyłącznie w aplikacji (powstaje wtedy nowa wersja).",
      };
    case "TJ403":
      return {
        status: 403,
        kod: "approval_forbidden",
        komunikat:
          "Zatwierdzać i odrzucać może wyłącznie użytkownik w aplikacji. Token API może tylko zgłosić propozycję (zakres propose).",
      };
    case "TJ422":
      // Ten sam kod SQLSTATE sluzy dwóm sprawom: bramka progu n przy wersjach regul (tabela rule_versions)
      // i niespojnosc danych w pozostalych triggerach (plan, werdykt, przeglad tygodnia).
      if (b.table_name === "rule_versions") {
        return {
          status: 422,
          kod: "below_threshold",
          komunikat:
            "Hipoteza ma za mało trade'ów (n poniżej progu), więc AI nie może zaproponować z niej reguły. Zbierz więcej danych albo zgłoś obserwację jako notatkę.",
        };
      }
      return {
        status: 422,
        kod: "inconsistent_data",
        komunikat:
          "Dane w zapisie są ze sobą sprzeczne (np. plan nie pasuje do trade'a, przegląd do poprzedniego tygodnia albo werdykt do swojego trade'a). Sprawdź powiązane identyfikatory i daty; szczegóły są w logach pod identyfikatorem zapytania.",
      };
    case "23505":
      return {
        status: 409,
        kod: "conflict",
        komunikat:
          "Taki wpis już istnieje (równoległy zapis tego samego albo zajęty unikalny klucz, np. tytuł, slug, externalRef). Odczytaj aktualny stan i ponów, jeśli nadal trzeba.",
      };
    case "23503":
      return {
        status: 422,
        kod: "unknown_reference",
        komunikat:
          "Zapis wskazuje rekord, którego nie ma (mógł zostać skasowany w aplikacji). Sprawdź identyfikatory (tradeId, noteId, sessionId...) i ponów.",
      };
    case "23514":
      return {
        status: 422,
        kod: "constraint_violated",
        komunikat:
          "Baza odrzuciła wartość jako niezgodną z regułą danych (dozwolone zakresy i dziedziny opisuje docs/openapi-v2.json). Szczegóły są w logach pod identyfikatorem zapytania.",
      };
    default:
      return null;
  }
}
