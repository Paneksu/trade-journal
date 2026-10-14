import { obsluzSesje } from "@/lib/api-v2/handlery";
import { zapisIngest } from "@/lib/api-v2/zapis";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/** POST /api/ingest/backtest-sessions. Zakres wygaszany (ADR-030); tresc: lib/api-v2/handlery.ts. */
export const POST = withIngest(async (request) => obsluzSesje(request, zapisIngest));
