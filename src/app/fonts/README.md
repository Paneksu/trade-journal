# Czcionki IBM Plex (wlasny hosting, 3 pliki)

Pobrane z Google Fonts API z parametrem `text=` (2026-10-16): tylko znaki z `znaki.txt` (ASCII, polskie
litery, znaki z kodu aplikacji). Zamiast 6 plikow z `next/font/google` (latin + latin-ext x 3 kroje,
104 KB, 6 zadan) sa 3 pliki (74 KB). Powod: Lighthouse mobile /trades (LCP symulowany, pomiar 16.10.2026).

Znak spoza zbioru (np. czeski) spada na krój zastepczy. Dodanie znaku: dopisz do `znaki.txt` i pobierz ponownie:
`https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400..600&text=<znaki>` (Mono: `wght@400`, `wght@500`).
