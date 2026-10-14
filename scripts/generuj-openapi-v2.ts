import { writeFileSync } from "node:fs";
import path from "node:path";

import { contractHash, tekstOpenApi } from "../src/lib/api-v2/contract/endpoints";

/*
 * Zapis docs/openapi-v2.json z rejestru tras (src/lib/api-v2/contract). Plik ma
 * LF i koncowy znak nowej linii: dokladnie te bajty, z ktorych liczy sie
 * contractHash. Test aktualnosci (endpoints.test.ts) pada, gdy ktos zmieni
 * schemat i zapomni uruchomic: npm run api:kontrakt
 */
const cel = path.resolve(__dirname, "../docs/openapi-v2.json");
writeFileSync(cel, tekstOpenApi(), { encoding: "utf8" });
console.log(`Zapisano ${cel}\ncontractHash: ${contractHash()}`);
