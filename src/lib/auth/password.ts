import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/*
 * Hasze hasel liczymy scryptem z wbudowanego modulu `node:crypto`.
 * Wybor swiadomy: argon2 wymaga binariow kompilowanych pod platforme,
 * co przy budowaniu obrazu w Coolify jest dodatkowym punktem awarii,
 * a scrypt z tymi parametrami (N = 2^16) w zupelnosci wystarcza
 * dla aplikacji z jednym kontem.
 */
const N = 65_536;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 256 * 1024 * 1024;

function scryptAsync(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");

  const computed = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });

  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function checkPasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (password.length < 10) return { ok: false, reason: "Hasło musi mieć co najmniej 10 znaków." };
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return { ok: false, reason: "Hasło musi zawierać małe i wielkie litery." };
  }
  if (!/[0-9]/.test(password)) return { ok: false, reason: "Hasło musi zawierać cyfrę." };
  return { ok: true };
}
