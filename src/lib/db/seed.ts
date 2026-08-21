import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { hashPassword } from "../auth/password";
import { CUSTOM_FIELDS, INSTRUMENTS, TAG_CATEGORIES, TAGS } from "./seed-data";
import * as schema from "./schema";

/*
 * Seed jest idempotentny: mozna go puscic ponownie na zywej bazie.
 * Nie nadpisuje niczego, co uzytkownik zdazyl zmienic - dopisuje brakujace.
 * Haslo ustawia tylko wtedy, gdy jeszcze zadnego nie ma.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" });

  // --- ustawienia i haslo ---
  const [existing] = await db.select().from(schema.settings).limit(1);
  if (!existing) {
    const password = process.env.OWNER_PASSWORD;
    if (!password) {
      throw new Error(
        "Baza jest pusta i nie ma zmiennej OWNER_PASSWORD. Ustaw ja, zeby seed mogl zalozyc haslo.",
      );
    }
    await db.insert(schema.settings).values({ id: 1, passwordHash: await hashPassword(password) });
    console.log("Ustawienia: utworzone, haslo ustawione z OWNER_PASSWORD");
  } else if (!existing.passwordHash && process.env.OWNER_PASSWORD) {
    await db
      .update(schema.settings)
      .set({ passwordHash: await hashPassword(process.env.OWNER_PASSWORD) })
      .where(eq(schema.settings.id, 1));
    console.log("Ustawienia: uzupelniono brakujace haslo");
  } else {
    console.log("Ustawienia: bez zmian");
  }

  // --- konto startowe ---
  const accounts = await db.select().from(schema.accounts).limit(1);
  if (accounts.length === 0) {
    await db.insert(schema.accounts).values({
      name: "Konto główne",
      currency: "USD",
      startingBalance: 5_000_000,
      type: "live",
      defaultRiskAmount: 10_000,
      sortOrder: 10,
    });
    console.log("Konta: utworzono konto glowne");
  }

  // --- instrumenty ---
  const added = await db
    .insert(schema.instruments)
    .values(INSTRUMENTS)
    .onConflictDoNothing({ target: schema.instruments.symbol })
    .returning({ symbol: schema.instruments.symbol });
  console.log(`Instrumenty: dodano ${added.length} z ${INSTRUMENTS.length}`);

  // --- kategorie tagow i tagi ---
  const existingCategories = await db.select().from(schema.tagCategories);
  const categoryIds = new Map(existingCategories.map((k) => [k.key, k.id]));

  for (const k of TAG_CATEGORIES) {
    if (categoryIds.has(k.key)) continue;
    const [created] = await db.insert(schema.tagCategories).values(k).returning();
    categoryIds.set(k.key, created.id);
  }

  const tagRows = TAGS.map((t, i) => ({
    categoryId: categoryIds.get(t.category) as number,
    name: t.name,
    color: t.color,
    sortOrder: i * 10,
  })).filter((t) => Number.isInteger(t.categoryId));

  if (tagRows.length > 0) {
    const addedTags = await db
      .insert(schema.tags)
      .values(tagRows)
      .onConflictDoNothing()
      .returning({ id: schema.tags.id });
    console.log(`Tagi: dodano ${addedTags.length}`);
  }

  // --- pola wlasne ---
  const addedFields = await db
    .insert(schema.customFields)
    .values(CUSTOM_FIELDS)
    .onConflictDoNothing({ target: schema.customFields.key })
    .returning({ key: schema.customFields.key });
  console.log(`Pola wlasne: dodano ${addedFields.length}`);

  await client.end();
  console.log("Seed: gotowe");
}

main().catch((error) => {
  console.error("Seed: blad", error);
  process.exit(1);
});
