/*
 * Service worker dziennika (UI v2, etap 4, PWA). Jedyne, co trzyma w pamięci podręcznej, to statyczna strona
 * „brak połączenia” i ikony. Żadnych stron z danymi, żadnego /api: dane finansowe nie lądują na telefonie.
 * Nawigacja idzie zawsze do sieci; dopiero gdy sieć nie odpowie, dostaje stronę offline.
 * Zmiana wersji = nowa nazwa pamięci, stare są kasowane przy aktywacji.
 */
const WERSJA = "tj-offline-v1";
const STATYCZNE = ["/offline.html", "/icons/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(WERSJA).then((c) => c.addAll(STATYCZNE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((klucze) => Promise.all(klucze.filter((k) => k !== WERSJA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API i zrzuty nigdy nie przechodzą przez pamięć podręczną (przeglądarka obsługuje je sama).
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (STATYCZNE.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((z) => z || fetch(req)));
  }
});
