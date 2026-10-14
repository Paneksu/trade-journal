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
    return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
  } finally {
    obrazy.dispose();
  }
}
