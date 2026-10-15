import "server-only";

/**
 * HEIC / HEIF z telefonu (iPhone) -> surowe piksele RGBA, ktore dalej obrabia `sharp`.
 * Gotowe binaria `sharp` dekoduja tylko AVIF (HEVC wymaga licencjonowanego kodeka), a
 * zdjecia z iPhone'a maja czesto wiecej odniesien w pliku, niz dopuszcza libheif w `sharp`
 * (blad »Security limit exceeded«). `heic-decode` (libheif w WebAssembly) czyta je bez
 * tych ograniczen, wiec dekodujemy nim, a `sharp` robi z wyniku WebP i miniature.
 *
 * Wymiary sprawdzamy PRZED dekodowaniem: plik HEIC do 10 MB moze deklarowac obraz o
 * wielu gigapikselach, a bufor RGBA to 4 bajty na piksel.
 */

export const LIMIT_PIKSELI_HEIC = 40_000_000;

export class BladHeic extends Error {}

/** Czy pierwsze bajty wygladaja jak kontener HEIF (»ftyp« + znana marka HEIC)? */
export function wygladaNaHeic(bajty: Uint8Array): boolean {
  if (bajty.length < 12) return false;
  const tekst = (od: number, do_: number) => String.fromCharCode(...bajty.slice(od, do_));
  if (tekst(4, 8) !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(tekst(8, 12));
}

type Pudelko = { typ: string; dane: number; koniec: number };

/** Pudelka ISO BMFF z zakresu [od, do): rozmiar 4 B, typ 4 B, rozmiar 1 = 64-bitowy, rozmiar 0 = do konca zakresu. */
function pudelka(bajty: Uint8Array, widok: DataView, od: number, do_: number): Pudelko[] {
  const wynik: Pudelko[] = [];
  let i = od;
  while (i + 8 <= do_) {
    let rozmiar = widok.getUint32(i);
    const typ = String.fromCharCode(bajty[i + 4], bajty[i + 5], bajty[i + 6], bajty[i + 7]);
    let naglowek = 8;
    if (rozmiar === 1) {
      if (i + 16 > do_) break;
      const duzy = widok.getBigUint64(i + 8);
      if (duzy > BigInt(do_ - i)) break;
      rozmiar = Number(duzy);
      naglowek = 16;
    } else if (rozmiar === 0) {
      rozmiar = do_ - i;
    }
    if (rozmiar < naglowek || i + rozmiar > do_) break;
    wynik.push({ typ, dane: i + naglowek, koniec: i + rozmiar });
    i += rozmiar;
  }
  return wynik;
}

/**
 * Najwiekszy deklarowany rozmiar obrazu w kontenerze HEIF, odczytany z metadanych BEZ dekodowania.
 * Pudelka »ispe« (4 B wersji i flag, potem szerokosc i wysokosc jako 32-bitowe big-endian) szukamy WYLACZNIE
 * tam, gdzie stoja w standardzie: meta > iprp > ipco. Skan calego pliku bajt po bajcie (wersja z audytu 7)
 * dawal falszywe trafienia w danych obrazu i pozwalal podsunac »ispe« w miejscu, ktore dekoder ignoruje
 * (review 15.10.2026). `null`, gdy w pliku nie ma zadnego takiego pudelka.
 */
export function wymiaryHeic(bajty: Uint8Array): { width: number; height: number } | null {
  const widok = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength);
  let najwiekszy: { width: number; height: number } | null = null;
  for (const meta of pudelka(bajty, widok, 0, bajty.length).filter((p) => p.typ === "meta")) {
    // »meta« to pelne pudelko: 4 bajty wersji i flag przed dziecmi.
    for (const iprp of pudelka(bajty, widok, meta.dane + 4, meta.koniec).filter((p) => p.typ === "iprp")) {
      for (const ipco of pudelka(bajty, widok, iprp.dane, iprp.koniec).filter((p) => p.typ === "ipco")) {
        for (const ispe of pudelka(bajty, widok, ipco.dane, ipco.koniec).filter((p) => p.typ === "ispe")) {
          if (ispe.koniec - ispe.dane < 12) continue;
          const width = widok.getUint32(ispe.dane + 4);
          const height = widok.getUint32(ispe.dane + 8);
          if (width > 0 && height > 0 && (najwiekszy === null || width * height > najwiekszy.width * najwiekszy.height)) najwiekszy = { width, height };
        }
      }
    }
  }
  return najwiekszy;
}

export async function dekodujHeic(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (!wygladaNaHeic(buffer)) {
    throw new BladHeic("Plik deklaruje typ HEIC/HEIF, ale jego nagłówek nie jest kontenerem HEIF (brak znacznika »ftyp« z marką heic/mif1). Wyeksportuj zdjęcie jako JPEG albo PNG.");
  }
  const decode = (await import("heic-decode")).default;
  let obrazy: Awaited<ReturnType<typeof decode.all>>;
  try {
    obrazy = await decode.all({ buffer });
  } catch (e) {
    throw new BladHeic(`Nie udało się odczytać pliku HEIC: ${(e as Error).message}`);
  }
  try {
    const pierwszy = obrazy[0];
    if (!pierwszy) throw new BladHeic("Plik HEIC nie zawiera obrazu.");
    if (pierwszy.width * pierwszy.height > LIMIT_PIKSELI_HEIC) {
      throw new BladHeic(`Obraz HEIC ma ${pierwszy.width}x${pierwszy.height} px (${pierwszy.width * pierwszy.height} px), a limit to ${LIMIT_PIKSELI_HEIC} px. Zmniejsz zdjęcie przed wysłaniem.`);
    }
    const { width, height, data } = await pierwszy.decode();
    // Po dekodowaniu porownujemy z limitem i z tym, co plik deklarowal w »ispe« (audyt N2, 15.10.2026): dekoder
    // nie moze oddac obrazu wiekszego niz deklaracja ani wiekszego niz limit.
    const zdekodowane = width * height;
    const deklarowane = wymiaryHeic(buffer);
    if (zdekodowane > LIMIT_PIKSELI_HEIC) {
      throw new BladHeic(`Po rozpakowaniu obraz HEIC ma ${width}x${height} px (${zdekodowane} px), a limit to ${LIMIT_PIKSELI_HEIC} px. Zmniejsz zdjęcie przed wysłaniem.`);
    }
    if (deklarowane !== null && zdekodowane > deklarowane.width * deklarowane.height) {
      throw new BladHeic(`Po rozpakowaniu obraz HEIC ma ${width}x${height} px, a plik deklarował najwyżej ${deklarowane.width}x${deklarowane.height} px (pudełko ispe). Plik jest uszkodzony albo spreparowany.`);
    }
    return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
  } finally {
    obrazy.dispose();
  }
}
