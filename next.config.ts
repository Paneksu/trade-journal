import type { NextConfig } from "next";

// HSTS wylacznie na produkcji: wysylany z serwera deweloperskiego zapisalby w przegladarce
// trwala regule "localhost zawsze przez https" i popsul inne lokalne serwisy.
const dev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Standalone: obraz dockerowy dla Coolify nie wlecze calego node_modules.
  output: "standalone",
  // Katalog nadrzedny ma wlasny package-lock.json; bez tego Turbopack szuka
  // korzenia projektu wyzej i wypisuje ostrzezenie przy kazdym starcie.
  turbopack: { root: __dirname },
  // Biblioteki z binariami natywnymi nie moga isc przez bundler.
  // heic-decode / libheif-js: dekoder HEIC w WebAssembly (kilka MB), wiec nie przez bundler.
  serverExternalPackages: ["sharp", "postgres", "heic-decode", "libheif-js"],
  experimental: {
    // Formularze wysylaja zrzuty ekranu przez Server Actions.
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // ADR-031: bez includeSubDomains i bez preload - pozostale subdomeny panekweb.pl
          // nie naleza do tej aplikacji i nie wolno ich zmuszac do HTTPS jej naglowkiem.
          ...(dev
            ? []
            : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
