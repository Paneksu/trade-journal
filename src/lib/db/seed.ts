import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { seed } from "./seed-core";

/*
 * Seed z wiersza polecen, do pracy lokalnej: `npm run seed`.
 * Ta sama logika chodzi przy pierwszym starcie kontenera - patrz
 * `src/instrumentation.ts`. Skrypt jest idempotentny, mozna go puscic ponownie.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" });

  await seed(db, (message) => console.log(message));

  await client.end();
  console.log("Seed: gotowe");
}

main().catch((error) => {
  console.error("Seed: błąd", error);
  process.exit(1);
});
