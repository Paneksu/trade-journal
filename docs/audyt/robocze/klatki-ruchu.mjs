// Pomiar klatek ruchu UI v2 przy spowolnieniu CPU 6x (CDP Emulation.setCPUThrottlingRate).
// Użycie: E2E_URL=http://localhost:3117 node docs/audyt/robocze/klatki-ruchu.mjs
// Zapisuje dla szuflady, palety i arkusza „+”: liczbę klatek rAF w oknie animacji, najdłuższą klatkę i wartości
// opacity/transform w kolejnych klatkach (dowód, że animacja płynie, a nie skacze).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = process.env.E2E_URL ?? "http://localhost:3117";
const sesja = JSON.parse(readFileSync(new URL("../../../e2e/.sesja.json", import.meta.url), "utf8"));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });

async function mierz(nazwa, viewport, przygotuj, wywolaj, selektor) {
  const ctx = await b.newContext({ baseURL: BASE, storageState: sesja, viewport, locale: "pl-PL" });
  const page = await ctx.newPage();
  await przygotuj(page);
  await page.waitForLoadState("networkidle");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.evaluate((sel) => {
    window.__k = [];
    const t0 = performance.now();
    let ostatnia = t0;
    const petla = (t) => {
      const el = document.querySelector(sel);
      if (el) {
        const c = getComputedStyle(el);
        window.__k.push({ t: Math.round(t - t0), dt: Math.round(t - ostatnia), op: Number(c.opacity).toFixed(2), tr: c.transform === "none" ? "none" : c.transform.replace("matrix(", "").replace(")", "").split(", ").slice(4).join(",") });
      }
      ostatnia = t;
      if (t - t0 < 1500) requestAnimationFrame(petla);
    };
    requestAnimationFrame(petla);
  }, selektor);
  await wywolaj(page);
  await page.waitForTimeout(1600);
  const k = await page.evaluate(() => window.__k);
  const okno = k.filter((x) => x.op !== "1.00" || x.tr !== "none");
  console.log(`\n== ${nazwa} (CPU 6x): klatek z ruchem ${okno.length}, najdłuższa klatka ${Math.max(...k.map((x) => x.dt))} ms`);
  console.log(okno.slice(0, 14).map((x) => `${x.t}ms op=${x.op} tr=${x.tr}`).join("\n"));
  await ctx.close();
}

await mierz(
  "szuflada",
  { width: 1440, height: 900 },
  (p) => p.goto("/trades"),
  (p) => p.locator("button[aria-label^='Podgląd trade']").first().click(),
  "aside[role=dialog]",
);
await mierz(
  "paleta Ctrl+K",
  { width: 1440, height: 900 },
  (p) => p.goto("/trades"),
  (p) => p.keyboard.press("Control+k"),
  "[role=dialog].tj-paleta",
);
await mierz(
  "arkusz plus (telefon)",
  { width: 375, height: 812 },
  (p) => p.goto("/"),
  (p) => p.getByRole("button", { name: "Szybki wpis" }).click(),
  "[role=dialog].tj-arkusz",
);
await b.close();
