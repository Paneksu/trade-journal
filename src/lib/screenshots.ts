import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";

import { SZEROKOSC_MINIATURY } from "@/components/screenshots/zrodla";
import { dekodujHeic, BladHeic, LIMIT_PIKSELI_HEIC, wygladaNaHeic, wymiaryHeic } from "./heic";
import { ownerDir, ownerSegment, safePath, tradeDir, type ShotOwner } from "./uploads-path";

/**
 * Zrzuty ekranu wykresow. Trzymamy je na dysku (w Dockerze: wolumen),
 * a nie w bazie - obrazy w bazie psuja kopie zapasowe i nic nie daja.
 * Nazwa pliku jest losowa, oryginalna nazwa uzytkownika nigdy nie trafia
 * do sciezki, wiec nie da sie nia wyjsc poza katalog.
 */

const HEIC = new Set(["image/heic", "image/heif"]);
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", ...HEIC]);
const MAX_BYTES = 10 * 1024 * 1024;
// Jedna stala z zrodla.ts: srcset podaje szerokosc miniatury (`560w`), wiec zapis i widok nie moga sie rozjechac.
const THUMBNAIL_WIDTH = SZEROKOSC_MINIATURY;

/**
 * Kiedy zapis bezstratny. Zrzut WYKRESU (zrodlo tradingview / fxreplay albo wklejony PNG) ma cienkie linie
 * i drobny tekst osi: stratny WebP (quality 88) rozmywal je (Slowa uzytkownika 20.10.2026: «w zrzutach dalej
 * te screeny sa rozmyte»). Bezstratny WebP: pomiar 20.10.2026 na zrzucie FX Replay 2706x1514 - 98 KB zamiast
 * 46 KB stratnie i zamiast 180 KB jako PNG (ten sam obraz co do piksela, a serwowanie zostaje image/webp).
 * Zdjecia (JPEG, HEIC, AVIF - telefon, aparat) zostaja stratne: bezstratnie wazylyby megabajty, a szum
 * matrycy i tak nie ma ostrych krawedzi do ochrony.
 */
export function zapisBezstratny(origin: "manual" | "tradingview" | "fxreplay", typ: string): boolean {
  return origin === "tradingview" || origin === "fxreplay" || typ === "image/png";
}

export type SavedScreenshot = {
  file: string;
  thumbnail: string;
  width: number;
  height: number;
  /** SHA-256 bajtow pliku WGRANEGO (przed konwersja do WebP): dowod do evidence_hash werdyktu AI. */
  sha256: string;
};

/** Czy plik przejdzie przez `saveScreenshot`? Pozwala odrzucic cala paczke PRZED zapisem pierwszego pliku. */
export function bladPliku(upload: File): string | null {
  if (!ALLOWED.has(upload.type)) {
    return `Plik »${upload.name}« ma typ »${upload.type || "brak"}«. Obsługiwane formaty to PNG, JPEG, WEBP, AVIF i HEIC.`;
  }
  if (upload.size > MAX_BYTES) {
    return `Plik »${upload.name}« ma ${upload.size} B, a limit to ${MAX_BYTES} B (10 MB).`;
  }
  return null;
}

/**
 * Czy zawartosc pliku jest obrazem tego typu? Sprawdza naglowek (HEIC: kontener HEIF; reszta: odczyt
 * metadanych przez sharp), bez dekodowania calego obrazu. Pozwala odrzucic plik z kodem 422 PRZED zapisem
 * czegokolwiek - w przeciwnym razie plik tylko udajacy obraz wyszedlby jako blad serwera.
 */
export async function bladZawartosci(upload: File): Promise<string | null> {
  const bajty = Buffer.from(await upload.arrayBuffer());
  if (HEIC.has(upload.type)) {
    if (!wygladaNaHeic(bajty)) {
      return `Plik »${upload.name}« deklaruje typ ${upload.type}, ale jego nagłówek nie jest kontenerem HEIF (brak znacznika »ftyp« z marką heic/mif1). Wyeksportuj zdjęcie jako JPEG albo PNG.`;
    }
    // Wymiary z metadanych kontenera, zanim dekoder zajmie pamiec na bufor RGBA (4 bajty na piksel).
    const wymiary = wymiaryHeic(bajty);
    if (wymiary === null) {
      return `Plik »${upload.name}« nie podaje wymiarów obrazu (brak pudełka »ispe«), więc nie wiem, ile pamięci zająłby po rozpakowaniu. Wyeksportuj zdjęcie jako JPEG albo PNG.`;
    }
    if (wymiary.width * wymiary.height > LIMIT_PIKSELI_HEIC) {
      return `Plik »${upload.name}« ma ${wymiary.width}x${wymiary.height} px (${wymiary.width * wymiary.height} px), a limit to ${LIMIT_PIKSELI_HEIC} px. Zmniejsz zdjęcie przed wysłaniem.`;
    }
    return null;
  }
  try {
    const meta = await sharp(bajty, { limitInputPixels: LIMIT_PIKSELI_HEIC }).metadata();
    if (!meta.width || !meta.height) throw new Error("brak wymiarów");
    return null;
  } catch (e) {
    return `Plik »${upload.name}« nie jest poprawnym obrazem (${upload.type || "brak typu"}): ${(e as Error).message}.`;
  }
}

export async function saveScreenshot(owner: ShotOwner, upload: File, opcje: { bezstratnie?: boolean } = {}): Promise<SavedScreenshot> {
  if (!ALLOWED.has(upload.type)) {
    throw new Error("Obsługiwane formaty to PNG, JPEG, WEBP, AVIF i HEIC.");
  }
  if (upload.size > MAX_BYTES) {
    throw new Error("Plik jest większy niż 10 MB.");
  }

  const dir = ownerDir(owner);
  await mkdir(dir, { recursive: true });

  const name = randomBytes(12).toString("hex");
  const buffer = Buffer.from(await upload.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  // Przepuszczamy przez sharpa takze po to, zeby odrzucic plik, ktory tylko
  // udaje obraz, i zeby zdjac z niego metadane EXIF. HEIC (zdjecia z iPhone'a)
  // dekoduje osobny dekoder, bo gotowy sharp czyta tylko AVIF.
  let zrodlo: Sharp;
  if (HEIC.has(upload.type)) {
    try {
      const raw = await dekodujHeic(buffer);
      zrodlo = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });
    } catch (e) {
      if (e instanceof BladHeic) throw new Error(e.message);
      throw e;
    }
  } else {
    zrodlo = sharp(buffer, { limitInputPixels: LIMIT_PIKSELI_HEIC });
  }
  const image = zrodlo.rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("Nie udało się odczytać obrazu — plik nie jest poprawnym obrazem.");

  const full = `${name}.webp`;
  const thumb = `${name}-mini.webp`;

  // effort 6: pomiar 20.10.2026 (2706x1514, FX Replay): 98 KB w 0,3-0,9 s; effort 4: 104 KB w 1,5-2,5 s.
  const bezstratnie = opcje.bezstratnie === true;
  await image
    .clone()
    .webp(bezstratnie ? { lossless: true, effort: 6 } : { quality: 88 })
    .toFile(path.join(dir, full));
  await image
    .clone()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp(bezstratnie ? { lossless: true, effort: 6 } : { quality: 80 })
    .toFile(path.join(dir, thumb));

  const segment = ownerSegment(owner);
  return {
    file: `${segment}/${full}`,
    thumbnail: `${segment}/${thumb}`,
    width: meta.width,
    height: meta.height,
    sha256,
  };
}

export async function deleteScreenshot(file: string, thumbnail: string | null): Promise<void> {
  for (const s of [file, thumbnail]) {
    if (!s) continue;
    const full = safePath(s);
    if (full) await rm(full, { force: true });
  }
}

export async function deleteTradeDir(tradeId: number): Promise<void> {
  await rm(tradeDir(tradeId), { recursive: true, force: true });
}

export async function deleteDayDir(dayNoteId: number): Promise<void> {
  await rm(ownerDir({ kind: "day", id: dayNoteId }), { recursive: true, force: true });
}

export async function fileExists(full: string): Promise<boolean> {
  try {
    const s = await stat(full);
    return s.isFile();
  } catch {
    return false;
  }
}
