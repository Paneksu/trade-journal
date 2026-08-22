import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { ownerDir, ownerSegment, safePath, tradeDir, type ShotOwner } from "./uploads-path";

/**
 * Zrzuty ekranu wykresow. Trzymamy je na dysku (w Dockerze: wolumen),
 * a nie w bazie - obrazy w bazie psuja kopie zapasowe i nic nie daja.
 * Nazwa pliku jest losowa, oryginalna nazwa uzytkownika nigdy nie trafia
 * do sciezki, wiec nie da sie nia wyjsc poza katalog.
 */

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const MAX_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_WIDTH = 560;

export type SavedScreenshot = {
  file: string;
  thumbnail: string;
  width: number;
  height: number;
};

export async function saveScreenshot(owner: ShotOwner, upload: File): Promise<SavedScreenshot> {
  if (!ALLOWED.has(upload.type)) {
    throw new Error("Obsługiwane formaty to PNG, JPEG, WEBP i AVIF.");
  }
  if (upload.size > MAX_BYTES) {
    throw new Error("Plik jest większy niż 10 MB.");
  }

  const dir = ownerDir(owner);
  await mkdir(dir, { recursive: true });

  const name = randomBytes(12).toString("hex");
  const buffer = Buffer.from(await upload.arrayBuffer());

  // Przepuszczamy przez sharpa takze po to, zeby odrzucic plik, ktory tylko
  // udaje obraz, i zeby zdjac z niego metadane EXIF.
  const image = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("Nie udało się odczytać obrazu — plik nie jest poprawnym obrazem.");

  const full = `${name}.webp`;
  const thumb = `${name}-mini.webp`;

  await image.clone().webp({ quality: 88 }).toFile(path.join(dir, full));
  await image
    .clone()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(dir, thumb));

  const segment = ownerSegment(owner);
  return {
    file: `${segment}/${full}`,
    thumbnail: `${segment}/${thumb}`,
    width: meta.width,
    height: meta.height,
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
