// Runda 3 znaku: szkice + finały + plansza. Z katalogu projektu:
//   node docs/audyt/robocze/generuj-znak-r3.mjs [--tylko-szkice]
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SZKICE, kafel } from "./znak-r3-szkice.mjs";

const ROOT = resolve("docs/design/znak/runda-3");
const tylkoSzkice = process.argv.includes("--tylko-szkice");

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svgText, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svgText.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

mkdirSync(join(ROOT, "szkice"), { recursive: true });
for (const [k, z] of Object.entries(SZKICE)) {
  const s = kafel(z.tresc());
  writeFileSync(join(ROOT, "szkice", `${k}.svg`), s);
  await png(s, 256, join(ROOT, "szkice", `${k}-256.png`));
}

if (!tylkoSzkice) {
  const { FINALY, OCENY, plansza } = await import("./znak-r3-finaly.mjs");
  for (const [k, f] of Object.entries(FINALY)) {
    const dir = join(ROOT, k);
    mkdirSync(dir, { recursive: true });
    const pelny = kafel(f.pelny());
    const mask = kafel(f.pelny(), { pelne: true, skala: 0.78 });
    const apple = kafel(f.pelny(), { pelne: true, skala: 0.9 });
    const fav = f.favicon();
    writeFileSync(join(dir, "icon-dark.svg"), pelny);
    writeFileSync(join(dir, "icon-maskable.svg"), mask);
    writeFileSync(join(dir, "apple-touch-icon.svg"), apple);
    writeFileSync(join(dir, "favicon.svg"), fav);
    writeFileSync(join(dir, "glif.svg"), f.glif());
    await png(fav, 16, join(dir, "favicon-16.png"));
    await png(fav, 32, join(dir, "favicon-32.png"));
    await png(apple, 180, join(dir, "apple-touch-icon-180.png"));
    await png(pelny, 192, join(dir, "icon-192.png"));
    await png(pelny, 512, join(dir, "icon-512.png"));
    await png(mask, 192, join(dir, "icon-maskable-192.png"));
    await png(mask, 512, join(dir, "icon-maskable-512.png"));
  }
  writeFileSync(join(ROOT, "plansza.html"), plansza(SZKICE));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(join(ROOT, "plansza.html")).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ROOT, "plansza.png"), fullPage: true });
} else {
  // arkusz roboczy szkiców
  const h = `<body style="margin:0;background:#0b0e12;display:grid;grid-template-columns:repeat(6,256px);gap:16px;padding:16px">${Object.keys(SZKICE).map((k) => `<img src="szkice/${k}-256.png">`).join("")}</body>`;
  writeFileSync(join(ROOT, "_arkusz.html"), h);
  await page.setViewportSize({ width: 1680, height: 560 });
  await page.goto(pathToFileURL(join(ROOT, "_arkusz.html")).href);
  await page.screenshot({ path: join(ROOT, "_arkusz.png"), fullPage: true });
}
await browser.close();
console.log("gotowe");
