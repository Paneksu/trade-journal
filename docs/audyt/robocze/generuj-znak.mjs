// Generator propozycji znaku (logo) dziennika: SVG + PNG + zrzut planszy.
// Uruchomienie: node docs/audyt/robocze/generuj-znak.mjs  (z katalogu projektu)
// Kolory z src/app/globals.css: --color-bg #0b0e12, --color-accent #e8a44c,
// --color-text #e7ecf1, --color-line-strong #35404d.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve("docs/design/znak");
const BG = "#0b0e12";
const ACCENT = "#e8a44c";
const TEXT = "#e7ecf1";
const EDGE = "#35404d";

// Siatka 32 x 32: 1 jednostka = 0,5 px przy 16 px, kreska 4 = 2 px.
const ZNAKI = {
  "a-zakres": {
    nazwa: "A. Zakres",
    glif: `<path d="M12 7H7v18h5M20 7h5v18h-5" fill="none" stroke="${TEXT}" stroke-width="4" stroke-linejoin="miter"/>
<path d="M12 16h8" stroke="${ACCENT}" stroke-width="4"/>`,
  },
  "b-monogram-d": {
    nazwa: "B. Monogram D",
    glif: `<path d="M9 8h6.5a8 8 0 0 1 0 16H9Z" fill="none" stroke="${ACCENT}" stroke-width="4" stroke-linejoin="miter"/>`,
  },
  "c-monogram-r": {
    nazwa: "C. Monogram R",
    glif: `<path d="M10 26V8h7a5 5 0 0 1 0 10h-7" fill="none" stroke="${ACCENT}" stroke-width="4" stroke-linejoin="miter"/>
<path d="M14.6 18h4.8l5.6 8h-4.8Z" fill="${ACCENT}"/>`,
  },
};

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n${inner}\n</svg>\n`;

// Wariant na ciemnym tle: kafel r=7 z ramką 1 px (widoczny także na ciemnym pasku kart).
const ciemny = (g) =>
  svg(`<rect width="32" height="32" rx="7" fill="${BG}"/>
<rect x=".5" y=".5" width="31" height="31" rx="6.5" fill="none" stroke="${EDGE}"/>
${g}`);

// Maskable: pełne tło, glif w 72% (mieści się w kole bezpiecznym r = 40% boku).
const maskable = (g) =>
  svg(`<rect width="32" height="32" fill="${BG}"/>
<g transform="translate(16 16) scale(.72) translate(-16 -16)">
${g}
</g>`);

// Apple touch: pełne tło bez przezroczystości (iOS sam zaokrągla rogi), glif 86%.
const apple = (g) =>
  svg(`<rect width="32" height="32" fill="${BG}"/>
<g transform="translate(16 16) scale(.86) translate(-16 -16)">
${g}
</g>`);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(svgText, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svgText.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [slug, z] of Object.entries(ZNAKI)) {
  const dir = join(ROOT, slug);
  mkdirSync(dir, { recursive: true });
  const fav = ciemny(z.glif);
  const mask = maskable(z.glif);
  const app = apple(z.glif);
  writeFileSync(join(dir, "favicon.svg"), fav);
  writeFileSync(join(dir, "icon-dark.svg"), fav);
  writeFileSync(join(dir, "icon-maskable.svg"), mask);
  writeFileSync(join(dir, "apple-touch-icon.svg"), app);
  // sam glif (do nagłówka aplikacji, bez kafla)
  writeFileSync(join(dir, "glif.svg"), svg(z.glif));
  await png(fav, 16, join(dir, "favicon-16.png"));
  await png(fav, 32, join(dir, "favicon-32.png"));
  await png(app, 180, join(dir, "apple-touch-icon-180.png"));
  await png(fav, 192, join(dir, "icon-192.png"));
  await png(fav, 512, join(dir, "icon-512.png"));
  await png(mask, 192, join(dir, "icon-maskable-192.png"));
  await png(mask, 512, join(dir, "icon-maskable-512.png"));
}

// Plansza
const plansza = join(ROOT, "plansza.html");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(pathToFileURL(plansza).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "plansza.png"), fullPage: true });
await browser.close();
console.log("gotowe");
