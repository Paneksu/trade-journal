import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";

import { isSignedIn } from "@/lib/auth/guard";
import { safePath } from "@/lib/uploads-path";

/**
 * Serwowanie zrzutow z wolumenu. Kazde zadanie sprawdza sesje - pliki
 * lezą poza katalogiem publicznym wlasnie po to, zeby nie dalo sie ich
 * pobrac bez zalogowania.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await isSignedIn())) {
    return new NextResponse("Brak dostępu", { status: 401 });
  }

  const { path } = await params;
  const relative = path.join("/");
  const full = safePath(relative);
  if (!full) return new NextResponse("Nie znaleziono", { status: 404 });

  try {
    const info = await stat(full);
    if (!info.isFile()) return new NextResponse("Nie znaleziono", { status: 404 });

    const stream = Readable.toWeb(createReadStream(full)) as WebReadableStream<Uint8Array>;
    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(info.size),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Nie znaleziono", { status: 404 });
  }
}
