import { obsluzInbox, obsluzInboxPing } from "@/lib/api-v2/broker";
import { withApi } from "@/lib/api-v2/with-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v2/broker/inbox: przyjecie pliku z eksportu brokera od automatu `tj watch-exports` (ADR-034 pkt 3). Surowe bajty
 * pliku (text/csv, do 5 MB). Przyjmuje WYLACZNIE token, ktorego jedynym zakresem jest import_broker; tokeny read, write
 * i propose dostaja 403. Stosuje tylko dopasowania 1:1 (z »Cofnij« w aplikacji) i nigdy nie tworzy trade'ow.
 */
export const POST = withApi({ scopes: ["import_broker"] }, async (request, api) => obsluzInbox(request, api));

/** GET /api/v2/broker/inbox: sprawdzenie tokenu automatu (jakie formaty, jaki limit, do kiedy wazny); nic nie zapisuje. */
export const GET = withApi({ scopes: ["import_broker"] }, async (_request, api) => obsluzInboxPing(api));
