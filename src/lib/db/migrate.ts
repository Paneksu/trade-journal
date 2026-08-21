import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/* Migracje uruchamiamy osobnym, jednorazowym polaczeniem - inaczej pula
   trzymalaby proces przy zyciu po zakonczeniu skryptu. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");

  const klient = postgres(url, { max: 1 });
  const db = drizzle(klient);
  console.log("Migracje: start");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migracje: gotowe");
  await klient.end();
}

main().catch((blad) => {
  console.error("Migracje: blad", blad);
  process.exit(1);
});
