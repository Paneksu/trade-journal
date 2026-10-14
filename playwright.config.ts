import { defineConfig, devices } from "@playwright/test";

/*
 * Testy E2E chodza po zywej aplikacji z prawdziwa baza.
 * Uruchamiaj je wylacznie na bazie lokalnej albo testowej - nigdy na produkcji,
 * bo dopisuja trade'y i pola wlasne.
 */
const BASE_URL = process.env.E2E_URL ?? "http://localhost:3000";
/* Port z E2E_URL, zeby rownolegle worktree'e (inna faza, inna baza) nie walczyly o :3000. */
const PORT = new URL(BASE_URL).port || "3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    baseURL: BASE_URL,
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
      testIgnore: /bezpieczenstwo.spec.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.sesja.json" },
    },
    /* 2FA zmienia wersje sesji i uniewaznia ciasteczka z `logowanie`, wiec ten
       projekt chodzi OSTATNI (po `dziennik`), bez zapisanej sesji, a po sobie
       przywraca baze (2FA wylaczone). */
    {
      name: "bezpieczenstwo",
      dependencies: ["dziennik"],
      testMatch: /bezpieczenstwo.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
