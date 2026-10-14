import { obsluzPominiecia } from "@/lib/api-v2/handlery";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

/** POST /api/ingest/skips. Zakres wygaszany (ADR-030); tresc: lib/api-v2/handlery.ts. */
export const POST = withIngest(async (request) => obsluzPominiecia(request));
