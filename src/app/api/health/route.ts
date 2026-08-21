import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Sonda dla Dockera i Coolify. Sprawdza takze baze - aplikacja, ktora odpowiada
 * na HTTP, ale nie widzi bazy, jest bezuzyteczna i healthcheck ma to wylapac.
 * Endpoint jest publiczny, ale nie zdradza niczego poza faktem, ze zyje.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "baza niedostępna" }, { status: 503 });
  }
}
