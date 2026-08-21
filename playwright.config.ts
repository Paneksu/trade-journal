import { defineConfig, devices } from "@playwright/test";

/*
 * Testy E2E chodza po zywej aplikacji z prawdziwa baza.
 * Uruchamiaj je wylacznie na bazie lokalnej albo testowej - nigdy na produkcji,
 * bo dopisuja trade'y i pola wlasne.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:3000",
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "logowanie", testMatch: /logowanie\.setup\.ts/ },
    {
      name: "dziennik",
      dependencies: ["logowanie"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.sesja.json" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
