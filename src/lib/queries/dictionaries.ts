import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accounts,
  backtestSessions,
  customFields,
  instruments,
  savedViews,
  strategies,
  tagCategories,
  tags,
} from "@/lib/db/schema";
import type { FieldDef } from "@/lib/fields/fields";

/** Slowniki uzywane niemal na kazdym ekranie. Cache trzyma je na jeden render. */

export const getAccounts = cache(async () =>
  db.select().from(accounts).orderBy(asc(accounts.sortOrder), asc(accounts.id)),
);

export const getInstruments = cache(async () =>
  db.select().from(instruments).orderBy(asc(instruments.sortOrder), asc(instruments.symbol)),
);

export const getStrategies = cache(async () =>
  db.select().from(strategies).orderBy(asc(strategies.name)),
);

export const getBacktestSessions = cache(async () =>
  db.select().from(backtestSessions).orderBy(asc(backtestSessions.status), asc(backtestSessions.name)),
);

export const getTagCategories = cache(async () =>
  db.select().from(tagCategories).orderBy(asc(tagCategories.sortOrder), asc(tagCategories.id)),
);

export const getTags = cache(async () =>
  db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      sortOrder: tags.sortOrder,
      archived: tags.archived,
      categoryId: tags.categoryId,
      category: tagCategories.name,
      categoryKey: tagCategories.key,
    })
    .from(tags)
    .innerJoin(tagCategories, eq(tags.categoryId, tagCategories.id))
    .orderBy(asc(tagCategories.sortOrder), asc(tags.sortOrder), asc(tags.name)),
);

export type TagWithCategory = Awaited<ReturnType<typeof getTags>>[number];

export const getFields = cache(async (): Promise<FieldDef[]> => {
  const rows = await db
    .select()
    .from(customFields)
    .orderBy(asc(customFields.sortOrder), asc(customFields.id));
  return rows as FieldDef[];
});

export const getSavedViews = cache(async () =>
  db.select().from(savedViews).orderBy(asc(savedViews.name)),
);

/** Instrument w postaci wymaganej przez modul obliczen. */
export function instrumentSpec(i: {
  tickSize: string;
  tickValue: number;
  commissionPerContract: number;
  rthFrom: string;
  rthTo: string;
  exchangeTimezone: string;
}) {
  return {
    tickSize: Number(i.tickSize),
    tickValue: Number(i.tickValue),
    commissionPerContract: Number(i.commissionPerContract),
    rthFrom: i.rthFrom,
    rthTo: i.rthTo,
    exchangeTimezone: i.exchangeTimezone,
  };
}
