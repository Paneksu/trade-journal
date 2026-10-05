import { odpowiedz } from "@/lib/ingest/http";
import { zbierzMeta } from "@/lib/ingest/meta";
import { withIngest } from "@/lib/ingest/with-ingest";

/** Slownik: konta, instrumenty, tagi, interwaly, limity. Klient dopasowuje sie do niego. */
export const dynamic = "force-dynamic";

export const GET = withIngest(async () => odpowiedz(await zbierzMeta()));
