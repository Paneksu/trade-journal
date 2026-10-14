import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Rdzen domeny jest czysty (model-danych 8, pkt 3): bez bazy, Next, server-only ani modulow Node.
  {
    files: ["src/lib/domain/**/*.ts"],
    ignores: ["src/lib/domain/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/lib/db", "@/lib/db/*", "next", "next/*", "server-only", "node:*", "postgres"], message: "lib/domain jest czyste: logika bez bazy, Next i modulow Node. Wynies I/O do lib/api-v2 albo lib/trades." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
