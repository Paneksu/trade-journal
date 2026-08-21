import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { hashPassword } from "../auth/password";
import { CUSTOM_FIELDS, INSTRUMENTS, TAG_CATEGORIES, TAGS } from "./seed-data";
import * as schema from "./schema";

/**
 * Dane poczatkowe. Jedna implementacja obsluguje dwa wejscia: polecenie
 * `npm run seed` przy pracy lokalnej i pierwsze uruchomienie kontenera
 * (`src/instrumentation.ts`). Dzieki temu nie ma dwoch wersji tej samej listy
 * kontraktow ani dwoch sposobow liczenia skrotu hasla.
 */

type Db = PostgresJsDatabase<typeof schema>;

export type SeedLog = (message: string) => void;

/** Czy baza ma juz wiersz ustawien, czyli czy przeszla przez seed. */
export async function isSeeded(db: Db): Promise<boolean> {
  const [row] = await db.select().from(schema.settings).limit(1);
  return Boolean(row);
}

export async function seed(db: Db, log: SeedLog = () => {}): Promise<void> {
  const password = process.env.OWNER_PASSWORD;

  // --- ustawienia i haslo ---
  const [existing] = await db.select().from(schema.settings).limit(1);
  if (!existing) {
    if (!password) {
      throw new Error(
        "Baza jest pusta i nie ma zmiennej OWNER_PASSWORD. Ustaw ją, żeby seed mógł założyć hasło.",
      );
    }
    await db.insert(schema.settings).values({ id: 1, passwordHash: await hashPassword(password) });
    log("Ustawienia: utworzone, hasło ustawione z OWNER_PASSWORD");
  } else if (!existing.passwordHash && password) {
    await db
      .update(schema.settings)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.settings.id, 1));
    log("Ustawienia: uzupełniono brakujące hasło");
  } else {
    log("Ustawienia: bez zmian");
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
    log("Konta: utworzono konto główne");
  }

  // --- instrumenty ---
  const added = await db
    .insert(schema.instruments)
    .values(INSTRUMENTS)
    .onConflictDoNothing({ target: schema.instruments.symbol })
    .returning({ symbol: schema.instruments.symbol });
  log(`Instrumenty: dodano ${added.length} z ${INSTRUMENTS.length}`);

  // --- kategorie tagow i tagi ---
  const existingCategories = await db.select().from(schema.tagCategories);
  const categoryIds = new Map(existingCategories.map((k) => [k.key, k.id]));

  for (const category of TAG_CATEGORIES) {
    if (categoryIds.has(category.key)) continue;
    const [created] = await db.insert(schema.tagCategories).values(category).returning();
    categoryIds.set(category.key, created.id);
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
    log(`Tagi: dodano ${addedTags.length}`);
  }

  // --- pola wlasne ---
  const addedFields = await db
    .insert(schema.customFields)
    .values(CUSTOM_FIELDS)
    .onConflictDoNothing({ target: schema.customFields.key })
    .returning({ key: schema.customFields.key });
  log(`Pola własne: dodano ${addedFields.length}`);
}

/**
 * Seed tylko wtedy, gdy baza jest zupelnie swieza.
 *
 * Warunek jest wazny: gdyby seed chodzil przy kazdym starcie, usuniete przez
 * uzytkownika instrumenty czy tagi wracalyby po restarcie kontenera.
 */
export async function seedIfEmpty(db: Db, log: SeedLog = () => {}): Promise<boolean> {
  if (await isSeeded(db)) return false;
  await seed(db, log);
  return true;
}
