import { obsluzOcene } from "@/lib/api-v2/handlery";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/ingest/trades/:id/reviews (application/json). Zakres wygaszany (ADR-030); tresc: lib/api-v2/handlery.ts. */
export const POST = withIngest<Ctx>(async (request, { params }) => obsluzOcene(request, (await params).id));
