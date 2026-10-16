import { headers } from "next/headers";

import { PustyStan, Strona } from "@/components/ui/v2";

/* Nieznany adres poza ekranami dziennika (np. literówka w adresie): po polsku, jedno działanie. Ekrany dziennika
   mają własny `(app)/not-found.tsx` w ramie aplikacji. */
export default async function NieZnalezionoGlowny() {
  // Render dynamiczny (review potwierdzające, B2): strona prerenderowana statycznie nie dostaje nonce z proxy, więc CSP
  // blokował jej skrypty na buildzie produkcyjnym. Odczyt nagłówków wymusza render przy żądaniu, z nonce.
  await headers();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <Strona className="max-w-md">
        <h1 className="mb-6 text-tytul font-medium tracking-tight text-text">Nie ma takiej strony</h1>
        <PustyStan tytul="Ten adres nie prowadzi do niczego w dzienniku." akcja={{ href: "/", etykieta: "Wróć do „Dziś”" }} />
      </Strona>
    </main>
  );
}
