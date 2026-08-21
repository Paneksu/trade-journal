import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

type Holder = {
  pool?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof build>;
};

function build() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Brak zmiennej DATABASE_URL. Ustaw ją w .env albo w panelu Coolify.");
  }
  // W trybie deweloperskim Next przeladowuje moduly; bez cache w globalu
  // kazde przeladowanie otwieraloby nowa pule polaczen.
  const holder = globalThis as unknown as Holder;
  if (!holder.pool) {
    holder.pool = postgres(url, { max: 10, idle_timeout: 20 });
  }
  return drizzle(holder.pool, { schema, casing: "snake_case" });
}

function instance() {
  const holder = globalThis as unknown as Holder;
  if (!holder.db) holder.db = build();
  return holder.db;
}

/**
 * Polaczenie powstaje przy pierwszym uzyciu, nie przy imporcie modulu.
 * Dzieki temu `next build` moze zaimportowac dowolna strone bez dostepu
 * do bazy - w obrazie dockerowym baza po prostu jeszcze nie istnieje.
 */
export const db = new Proxy({} as ReturnType<typeof build>, {
  get(_target, property, receiver) {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, property, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
