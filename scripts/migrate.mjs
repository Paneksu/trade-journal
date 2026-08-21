import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

/*
 * Migracje uruchamiane przy starcie kontenera.
 *
 * Czysty JavaScript na sterowniku `postgres` - i tylko na nim. Obraz produkcyjny
 * zawiera wylacznie te moduly, ktore importuje sama aplikacja, wiec migrator
 * z drizzle-orm nie jest w nim dostepny.
 *
 * Format zapisu jest identyczny jak w drizzle-kit: schemat `drizzle`,
 * tabela `__drizzle_migrations`, skrot SHA-256 z tresci pliku SQL.
 * Dzieki temu lokalne `npm run db:migrate` i start kontenera widza ten sam stan.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Brak DATABASE_URL - nie ma czego migrowac.");
  process.exit(1);
}

const folder = path.resolve("./drizzle");
// `onnotice` wycisza komunikaty typu "schema already exists" - przy starcie
// kontenera to szum, ktory wyglada w logach jak blad.
const client = postgres(url, { max: 1, onnotice: () => {} });

try {
  const journal = JSON.parse(await readFile(path.join(folder, "meta", "_journal.json"), "utf8"));

  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const applied = await client`SELECT hash FROM drizzle.__drizzle_migrations`;
  const known = new Set(applied.map((row) => row.hash));

  let count = 0;
  for (const entry of journal.entries) {
    const sqlText = await readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");
    if (known.has(hash)) continue;

    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    await client.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry.when})
      `;
    });

    console.log(`Migracje: zastosowano ${entry.tag}`);
    count += 1;
  }

  console.log(count === 0 ? "Migracje: nic nowego" : `Migracje: gotowe (${count})`);
} catch (error) {
  console.error("Migracje: blad", error);
  process.exit(1);
} finally {
  await client.end();
}
