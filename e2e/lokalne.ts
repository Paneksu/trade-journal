/**
 * Bezpiecznik testow piszacych do bazy: baza ORAZ adres aplikacji (E2E_URL)
 * musza byc lokalne. Sama baza nie wystarcza - E2E_URL na produkcje oznaczalby
 * zapisy przez produkcyjne API pod lokalnym tokenem albo zalogowana sesja.
 *
 * Lokalna kopia logiki z narzedzia/bezpiecznik-produkcji.mjs (agencja), celowo
 * WEZSZA: tylko localhost, 127.0.0.0/8 i ::1 (bez .local i host.docker.internal).
 * Fail closed: pusty albo nieczytelny adres to nie-lokalny.
 */

function hostLokalny(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
  } catch {
    return false;
  }
}

function ukryjHaslo(url: string): string {
  return url.replace(/:[^:@/]*@/, ":***@") || "brak";
}

export function wymagajLokalnych(dbUrl: string, appUrl: string | undefined): void {
  const app = appUrl ?? "http://localhost:3000";
  if (!hostLokalny(dbUrl)) {
    throw new Error(
      `DATABASE_URL (${ukryjHaslo(dbUrl)}) nie wskazuje na bazę lokalną - testy piszą do bazy i nie wolno ich puszczać na produkcji.`,
    );
  }
  if (!hostLokalny(app)) {
    throw new Error(
      `E2E_URL (${app}) nie wskazuje na lokalny serwer (localhost, 127.x.x.x, ::1) - testy zapisują dane przez aplikację i nie wolno ich puszczać na produkcji.`,
    );
  }
}
