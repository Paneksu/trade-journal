/**
 * Adres docelowy po zalogowaniu (parametr `wroc`) - tylko w obrebie aplikacji,
 * inaczej bylby to otwarty przekierowywacz, a po wystawieniu aplikacji do internetu
 * idealny do phishingu "sesja wygasla, zaloguj sie ponownie" z kodem TOTP.
 *
 * Sprawdzamy WYNIK parsowania, nie prefiks: przegladarka i router Nexta usuwaja
 * tabulatory i znaki nowej linii z adresu, wiec "/\t/evil.com" po obrobce to
 * "//evil.com". Dlatego znaki sterujace i odwrotny ukosnik odrzucamy od razu, a reszte
 * przepuszczamy tylko wtedy, gdy po rozwiazaniu adresu zostaje na tym samym origin.
 */
const SZTUCZNY_ORIGIN = "http://aplikacja.invalid";
const ZABRONIONE = /[\u0000-\u001f\u007f\\]/;

export function celWAplikacji(cel: string): string {
  if (!cel.startsWith("/") || ZABRONIONE.test(cel)) return "/";
  try {
    const u = new URL(cel, SZTUCZNY_ORIGIN);
    if (u.origin !== SZTUCZNY_ORIGIN) return "/";
    const wynik = u.pathname + u.search + u.hash;
    // "/.//evil.com" normalizuje sie do sciezki "//evil.com", czyli adresu bez schematu.
    return wynik.startsWith("//") ? "/" : wynik;
  } catch {
    return "/";
  }
}
