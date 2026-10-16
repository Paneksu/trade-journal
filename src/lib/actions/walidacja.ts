import { z } from "zod";

import { sprawdzTekstBajtWBajt } from "@/lib/domain/notatki";

/*
 * Walidacja akcji serwera UI (audyt bezpieczeństwa fazy 5, pkt 5): te same schematy co API v2 plus jeden pomocnik
 * na teksty użytkownika. Akcja serwera to publiczny punkt POST, więc formularz w przeglądarce niczego nie gwarantuje
 * (pamięć: walidacja-w-przegladarce-nie-jest-zabezpieczeniem).
 */

/** Tekst użytkownika zapisany bajt w bajt: bez NUL, poprawny UTF-16 i najwyżej `maxBajtow` bajtów UTF-8. */
export function tekstUzytkownika(maxBajtow: number) {
  return z.string().superRefine((t, ctx) => {
    const b = sprawdzTekstBajtWBajt(t);
    if (!b.ok) ctx.addIssue({ code: "custom", message: b.powod });
    const bajty = Buffer.byteLength(t, "utf8");
    if (bajty > maxBajtow) ctx.addIssue({ code: "custom", message: `najwyżej ${maxBajtow} bajtów (jest ${bajty})` });
  });
}

/** Pierwszy błąd walidacji po polsku z nazwą pola z formularza (zamiast ścieżki z API). */
export function bladWalidacji(e: z.ZodError, nazwy: Record<string, string> = {}): string {
  const i = e.issues[0];
  if (!i) return "Niepoprawne dane formularza.";
  const sciezka = i.path.join(".");
  const pole = nazwy[sciezka] ?? (sciezka || "formularz");
  return `${pole}: ${i.message}`;
}

/** Wartość z FormData jako tekst z LF (formularz HTML wysyła nowe linie jako CRLF); brak pola = null. */
export function poleLf(d: FormData, k: string): string | null {
  const w = d.get(k);
  return typeof w === "string" ? w.replace(/\r\n/g, "\n") : null;
}
