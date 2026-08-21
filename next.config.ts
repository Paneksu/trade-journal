import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone: obraz dockerowy dla Coolify nie wlecze calego node_modules.
  output: "standalone",
  // Katalog nadrzedny ma wlasny package-lock.json; bez tego Turbopack szuka
  // korzenia projektu wyzej i wypisuje ostrzezenie przy kazdym starcie.
  turbopack: { root: __dirname },
  // Biblioteki z binariami natywnymi nie moga isc przez bundler.
  serverExternalPackages: ["sharp", "postgres"],
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
        ],
      },
    ];
  },
};

export default nextConfig;
