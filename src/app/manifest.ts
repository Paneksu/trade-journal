import type { MetadataRoute } from "next";

/*
 * Manifest PWA (plan fazy 5, „PWA (telefon)”). Ikony ze znaku FVG V1
 * (docs/design/znak/runda-4-fvg/v1-bycza-ce): zwykle i maskable osobno, bo maskable
 * ma bezpieczna strefe 80% (inaczej Android przycina swiece znaku).
 * Kolory = tokeny marki (--color-bg #0b0e12). Offline shell to kolejny etap.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dziennik tradingowy",
    short_name: "Dziennik",
    description: "Prywatny dziennik transakcji i backtestów.",
    lang: "pl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0e12",
    theme_color: "#0b0e12",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
