import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge musi znac rozmiary tekstu z tokenow (globals.css, `--text-*`). Bez tego `text-meta`
 * i `text-text` (kolor) wygladaja dla niego jak ten sam konflikt i rozmiar znika po cichu.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["tytul", "liczba", "sekcja", "karta", "meta", "grupa"],
    },
  },
});

/** Laczy klasy i rozstrzyga konflikty Tailwinda (ostatnia wygrywa). */
export function cx(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
