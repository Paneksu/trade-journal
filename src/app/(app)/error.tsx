"use client";

import { useEffect } from "react";
import Link from "next/link";

import { klasaPigulki, Strona } from "@/components/ui/v2";

/* Błąd ekranu (runda r2): po polsku, bez szczegółów technicznych na ekranie; numer zdarzenia do logów serwera. */
export default function BladEkranu({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Strona>
      <div role="alert" className="mx-auto max-w-md space-y-3 py-16 text-center">
        <h1 className="text-tytul font-medium tracking-tight text-text">Coś poszło nie tak</h1>
        <p className="text-karta text-muted">Ten ekran nie wczytał się do końca. Dane są bezpieczne: nic nie zostało zapisane w połowie.</p>
        {error.digest && <p className="num text-meta text-faint">Numer zdarzenia: {error.digest}</p>}
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <button type="button" onClick={reset} className={klasaPigulki(true)}>
            Spróbuj ponownie
          </button>
          <Link href="/" className={klasaPigulki(false)}>
            Wróć do „Dziś”
          </Link>
        </div>
      </div>
    </Strona>
  );
}
