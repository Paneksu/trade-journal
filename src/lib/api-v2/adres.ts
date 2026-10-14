/**
 * Porownanie adresu urzadzenia z adresem przegladarki na ekranie zatwierdzenia.
 * Czyste (bez Node), bo uzywa tego komponent kliencki. Roznica nie jest dowodem
 * ataku (VPN, IPv6 vs IPv4), ale ma wywolac ostrzezenie przed zatwierdzeniem.
 */
export function normalizujAdres(ip: string): string {
  return ip.trim().toLowerCase().replace(/^::ffff:/, "");
}

export function czyInnyAdres(ipUrzadzenia: string | null | undefined, ipPrzegladarki: string | null | undefined): boolean {
  if (!ipUrzadzenia || !ipPrzegladarki) return false;
  if (ipPrzegladarki === "nieznany" || ipUrzadzenia === "nieznany") return false;
  return normalizujAdres(ipUrzadzenia) !== normalizujAdres(ipPrzegladarki);
}
