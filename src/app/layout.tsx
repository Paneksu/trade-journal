import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { RejestracjaSw } from "@/components/layout/rejestracja-sw";

import "./globals.css";

// Wlasny hosting zamiast next/font/google: 3 pliki zamiast 6 (src/app/fonts/README.md).
const plexSans = localFont({
  src: [{ path: "./fonts/plex-sans-var.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-plex-sans",
  display: "swap",
  adjustFontFallback: "Arial",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Dziennik tradingowy",
  description: "Prywatny dziennik transakcji i backtestow.",
  robots: { index: false, follow: false },
  applicationName: "Dziennik",
  /* Znak FVG V1 (docs/design/znak/runda-4-fvg/v1-bycza-ce, decyzja uzytkownika 14.10.2026). */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32" },
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Dziennik", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0e12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <RejestracjaSw />
      </body>
    </html>
  );
}
