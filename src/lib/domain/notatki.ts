/**
 * Czyste funkcje notatek (ADR-029): slug z tytulu, linki [[...]] i skrot tresci.
 * Bez importu bazy, Next ani modulow Node - to jest rdzen, ktory testujemy jednostkowo i
 * ktory moze trafic do przegladarki. Skrot SHA-256 tekstu liczy serwer (lib/api-v2/skrot.ts).
 */
/** Polskie litery, ktorych NFD nie rozklada (ł) albo rozklada inaczej niz unaccent. */
const MAPA_LITER: Record<string, string> = {
  "ł": "l",
  "Ł": "L",
  "ß": "ss",
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
  "ø": "o",
  "Ø": "O",
  "đ": "d",
  "Đ": "D",
};

/** Tytul -> slug zgodny z CHECK `^[a-z0-9][a-z0-9-]{0,119}$`. Pusty wynik oznacza "tytul bez liter ani cyfr". */
export function slugZTytulu(tytul: string): string {
  const bezOgonkow = tytul
    .replace(/[łŁßæÆœŒøØđĐ]/g, (c) => MAPA_LITER[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const slug = bezOgonkow
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug;
}

/** Slug z numerem, gdy podstawowy jest zajety: "plan-2", "plan-3"... mieści się w 120 znakach. */
export function slugZNumerem(podstawa: string, numer: number): string {
  const sufiks = `-${numer}`;
  return `${podstawa.slice(0, 120 - sufiks.length).replace(/-+$/g, "")}${sufiks}`;
}

/**
 * Cele linkow [[Tytul]] i [[Tytul|alias]] z tresci markdown. Zwraca unikalne
 * cele (bez aliasu, bez fragmentu #naglowek), w kolejnosci pierwszego wystapienia.
 * Linki w blokach kodu (``` i `...`) sa pomijane - w Obsidianie tez nie dzialaja.
 */
export function wyciagnijLinki(markdown: string): string[] {
  const bezKodu = markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const wynik: string[] = [];
  const widziane = new Set<string>();
  for (const m of bezKodu.matchAll(/\[\[([^\[\]\n]{1,200})\]\]/g)) {
    let cel = m[1];
    const kreska = cel.indexOf("|");
    if (kreska !== -1) cel = cel.slice(0, kreska);
    const hash = cel.indexOf("#");
    if (hash !== -1) cel = cel.slice(0, hash);
    cel = cel.trim();
    if (cel === "") continue;
    const klucz = cel.toLowerCase();
    if (widziane.has(klucz)) continue;
    widziane.add(klucz);
    wynik.push(cel);
  }
  return wynik;
}

/**
 * Tekst, ktory przejdzie przez JSON i Postgresa bez zmiany ani jednego bajtu.
 * Odrzuca bajt NUL (Postgres go nie przyjmie w `text`) i samotne surogaty
 * (UTF-8 nie ma na nie kodu, wiec zostalyby zamienione na U+FFFD).
 */
export function sprawdzTekstBajtWBajt(tekst: string): { ok: true } | { ok: false; powod: string } {
  const nul = tekst.indexOf("\u0000");
  if (nul !== -1) {
    return { ok: false, powod: `znak NUL na pozycji ${nul} (Postgres nie przyjmuje go w tekście; usuń go u klienta)` };
  }
  if (!tekst.isWellFormed()) {
    let poz = 0;
    for (let i = 0; i < tekst.length; i += 1) {
      const c = tekst.charCodeAt(i);
      const wysoki = c >= 0xd800 && c <= 0xdbff;
      const niski = c >= 0xdc00 && c <= 0xdfff;
      if (wysoki && tekst.charCodeAt(i + 1) >= 0xdc00 && tekst.charCodeAt(i + 1) <= 0xdfff) {
        i += 1;
        continue;
      }
      if (wysoki || niski) {
        poz = i;
        break;
      }
    }
    return {
      ok: false,
      powod: `samotny surogat UTF-16 na pozycji ${poz} (to nie jest poprawny UTF-8 i zostałby zamieniony na U+FFFD; wyślij tekst jako poprawny Unicode)`,
    };
  }
  return { ok: true };
}
