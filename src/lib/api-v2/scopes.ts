/** Zakresy tokenow API v2 (ADR-030). Czwartego ("zatwierdz") nie ma i CHECK w bazie nie pozwoli go dopisac. */
export const SCOPES = ["read", "write", "propose"] as const;
export type Scope = (typeof SCOPES)[number];

export function czyScope(w: unknown): w is Scope {
  return typeof w === "string" && (SCOPES as readonly string[]).includes(w);
}
