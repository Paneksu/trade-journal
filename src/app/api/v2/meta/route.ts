import { odpowiedz } from "@/lib/api-v2/http";
import { zbierzMeta } from "@/lib/api-v2/meta";
import { withApi } from "@/lib/api-v2/with-api";

/** Slownik: konta, instrumenty, tagi, interwaly, limity, zakresy i contractHash kontraktu. */
export const dynamic = "force-dynamic";

export const GET = withApi({ scopes: ["read"] }, async () => odpowiedz(await zbierzMeta(2)));
