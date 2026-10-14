import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Testy na wspolnej, lokalnej bazie (npm run test:db) dziela stan globalny (limit zadan
    // urzadzen, tokeny, kolejki), wiec pliki idą po kolei. Calosc i tak trwa kilka sekund.
    fileParallelism: false,
  },
});
