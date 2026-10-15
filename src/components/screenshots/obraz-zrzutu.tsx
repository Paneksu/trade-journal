"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ImageOff } from "lucide-react";

import { cx } from "@/lib/classes";

/**
 * Obraz zrzutu z wolumenu (`/api/screenshots/...`). Gdy pliku nie ma (404, skasowany katalog, błąd dekodowania),
 * zamiast zepsutej ikonki przeglądarki pokazuje neutralne pole „zrzut niedostępny” w tych samych wymiarach
 * (bramka designu etapu 1, runda 3: puste pole obrazu to bloker). Błąd sprzed hydratacji łapie sprawdzenie
 * `complete && naturalWidth === 0` po zamontowaniu, bo `onError` z Reacta przychodzi dopiero po hydratacji.
 */
export function ObrazZrzutu({ className, alt, ...rest }: ComponentProps<"img">) {
  const ref = useRef<HTMLImageElement>(null);
  const [blad, setBlad] = useState(false);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) {
      // Jednorazowa synchronizacja ze stanem DOM po hydratacji (zdarzenie error już minęło).
      setBlad(true);
    }
  }, []);

  if (blad) {
    return (
      <span
        role="img"
        aria-label={`${alt ?? "Zrzut"}: zrzut niedostępny`}
        className={cx("flex flex-col items-center justify-center gap-1 bg-surface-2 text-meta text-muted", className)}
      >
        <ImageOff size={16} aria-hidden />
        <span className="text-grupa">zrzut niedostępny</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- plik za sesją, poza next/image
  return <img ref={ref} alt={alt} className={className} onError={() => setBlad(true)} {...rest} />;
}
