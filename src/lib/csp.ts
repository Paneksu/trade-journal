/**
 * Content-Security-Policy aplikacji (audyt bezpieczeństwa fazy 5, pkt 6, 16.10.2026). Nagłówek ustawia `proxy.ts`
 * z nonce na każde żądanie: Next dokleja ten nonce do własnych skryptów, gdy znajdzie go w nagłówku CSP żądania
 * (strony renderowane dynamicznie: `(app)` i `/login` mają `force-dynamic`).
 *
 * - `script-src 'self' 'nonce-…' 'strict-dynamic'`: tylko skrypty Next z nonce i to, co one doładują.
 * - `'unsafe-eval'` WYŁĄCZNIE w dev: React w trybie deweloperskim używa eval do stosów wywołań; bez niego dev nie
 *   hydratuje (wiedza: csp-unsafe-eval-blokuje-hydratacje). Produkcja go nie ma.
 * - `style-src 'self' 'unsafe-inline'`: React wstawia atrybuty `style` (szerokości pasków, pozycje na wykresach),
 *   a strona offline ma wbudowany `<style>`; nonce nie obejmuje atrybutów stylu. Styl nie wykonuje kodu.
 * - `img-src` z `data:` i `blob:`: podgląd zrzutu przed wysłaniem i ikony w SVG inline.
 */
export function politykaCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Nonce: 16 losowych bajtów w base64 (Web Crypto, działa w proxy Next na Node). */
export function nowyNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
