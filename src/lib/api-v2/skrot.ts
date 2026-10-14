import { createHash } from "node:crypto";

/** SHA-256 hex z bajtow UTF-8, bez normalizacji i bez zamiany koncow linii. */
export function skrotTekstu(tekst: string): string {
  return createHash("sha256").update(Buffer.from(tekst, "utf8")).digest("hex");
}
