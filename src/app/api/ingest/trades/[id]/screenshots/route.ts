import { obsluzZrzuty } from "@/lib/api-v2/handlery";
import { withIngest } from "@/lib/ingest/with-ingest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/ingest/trades/:id/screenshots (multipart/form-data). Zakres wygaszany (ADR-030); tresc: lib/api-v2/handlery.ts. */
export const POST = withIngest<Ctx>(async (request, { params }) => obsluzZrzuty(request, (await params).id));
