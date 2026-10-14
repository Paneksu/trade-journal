/**
 * Zakresy tokenow API v2 (ADR-030). Czwartego ("zatwierdz") nie ma i CHECK w bazie nie pozwoli go
 * dopisac. `import` (Slowa uzytkownika 15.10.2026: «Osobny zakres „import”») jest zakresem
 * DODATKOWYM: sam nic nie otwiera, ale tylko z nim wolno zadeklarowac pochodzenie
 * `vault-import` (z nImported i vaultStatus) oraz `mentor`. Nadaje go wylacznie uzytkownik recznie
 * w UI (przycisk "token importu", 24 h), NIGDY logowanie kodem urzadzenia.
 */
export const SCOPES = ["read", "write", "propose", "import"] as const;
export type Scope = (typeof SCOPES)[number];

/** Zakresy, o ktore wolno prosic przy logowaniu kodem urzadzenia (bez `import`). */
export const SCOPES_URZADZEN = ["read", "write", "propose"] as const;
export type ScopeUrzadzenia = (typeof SCOPES_URZADZEN)[number];

/** Pochodzenia deklarowane przez klienta, ktore wymagaja zakresu `import`. */
export const ORIGINY_WYMAGAJACE_IMPORTU = ["vault-import", "mentor"] as const;

export function czyScope(w: unknown): w is Scope {
  return typeof w === "string" && (SCOPES as readonly string[]).includes(w);
}

export function czyScopeUrzadzenia(w: unknown): w is ScopeUrzadzenia {
  return typeof w === "string" && (SCOPES_URZADZEN as readonly string[]).includes(w);
}

export function originWymagaImportu(origin: string): boolean {
  return (ORIGINY_WYMAGAJACE_IMPORTU as readonly string[]).includes(origin);
}
