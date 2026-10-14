// Runda 4: znak FVG (wybór użytkownika z rundy 3, szkic 2). Z katalogu projektu:
//   node docs/audyt/robocze/generuj-znak-r4.mjs
// Warianty: V1 bycza luka ze strefą i CE 50%, V2 niedźwiedzia luka ze strefą i CE,
// V3 bycza luka jako przerwa z kreskowaniem, bez CE.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { kafel, A, BG } from "./znak-r3-szkice.mjs";

const ROOT = resolve("docs/design/znak/runda-4-fvg");
const OCENY = JSON.parse(readFileSync(new URL("./znak-r4-oceny.json", import.meta.url), "utf8"));

// Świeca z detalem: knot z metalu z refleksem, korpus z metalu, światło na górnej krawędzi,
// cienka jasna obwódka korpusu i ciemna krawędź od dołu.
function swieca(x, w, k1, b1, b2, k2, rodzaj = "zloto") {
  const metal = rodzaj === "zloto" ? "url(#metal)" : "url(#stal)";
  const knot = rodzaj === "zloto" ? "url(#knotZ)" : "url(#knotS)";
  const jasny = rodzaj === "zloto" ? "#fde2ae" : "#d5dde5";
  const kw = Math.round(w * 0.13);
  const r = Math.round(w * 0.09);
  return `<g>
<rect x="${x - kw / 2}" y="${k1}" width="${kw}" height="${b1 - k1 + r}" rx="${kw / 2}" fill="${knot}"/>
<rect x="${x - kw / 2}" y="${b2 - r}" width="${kw}" height="${k2 - b2 + r}" rx="${kw / 2}" fill="${knot}"/>
<rect x="${x - w / 2}" y="${b1}" width="${w}" height="${b2 - b1}" rx="${r}" fill="${metal}"/>
<rect x="${x - w / 2 + 1}" y="${b1 + 1}" width="${w - 2}" height="${b2 - b1 - 2}" rx="${r - 1}" fill="none" stroke="${jasny}" stroke-opacity=".35" stroke-width="2"/>
<rect x="${x - w / 2 + 5}" y="${b1 + 4}" width="${w - 10}" height="4" rx="2" fill="#fff" fill-opacity=".5"/>
<rect x="${x - w / 2 + 3}" y="${b2 - 10}" width="${w - 6}" height="6" rx="3" fill="#000" fill-opacity=".18"/>
</g>`;
}

const defsR4 = `<defs>
<linearGradient id="knotZ" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b3722a"/><stop offset=".45" stop-color="#fde2ae"/><stop offset="1" stop-color="#a86a22"/></linearGradient>
<linearGradient id="knotS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a5562"/><stop offset=".45" stop-color="#c3ccd5"/><stop offset="1" stop-color="#3a434e"/></linearGradient>
<linearGradient id="strefa" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f5b968" stop-opacity=".34"/><stop offset=".6" stop-color="#f5b968" stop-opacity=".22"/><stop offset="1" stop-color="${A}" stop-opacity=".06"/></linearGradient>
<linearGradient id="krawedzStrefy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${A}"/><stop offset=".7" stop-color="${A}" stop-opacity=".8"/><stop offset="1" stop-color="${A}" stop-opacity=".15"/></linearGradient>
<pattern id="kreski" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="14" fill="${A}" fill-opacity=".38"/></pattern>
<radialGradient id="blaskSwiecy" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${A}" stop-opacity=".35"/><stop offset="1" stop-color="${A}" stop-opacity="0"/></radialGradient>
</defs>`;

// Strefa FVG od y1 do y2, od x1 do prawej krawędzi treści.
function strefa(y1, y2, x1, { ce = true, styl = "pole" } = {}) {
  const x2 = 444;
  const sr = (y1 + y2) / 2;
  const pole =
    styl === "pole"
      ? `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="url(#strefa)"/>`
      : styl === "oba"
      ? `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="url(#strefa)"/><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="url(#kreski)" fill-opacity=".45"/>`
      : `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="url(#kreski)"/>`;
  return `${pole}
<rect x="${x1}" y="${y1 - 1.5}" width="${x2 - x1}" height="3" fill="url(#krawedzStrefy)"/>
<rect x="${x1}" y="${y2 - 1.5}" width="${x2 - x1}" height="3" fill="url(#krawedzStrefy)"/>
<rect x="${x1 - 1.5}" y="${y1}" width="3" height="${y2 - y1}" fill="${A}" fill-opacity=".9"/>
${ce ? `<path d="M${x1 + 6} ${sr}H${x2}" stroke="#fde2ae" stroke-opacity=".8" stroke-width="2.5" stroke-dasharray="9 7"/>` : ""}`;
}

// ---------- warianty (siatka 512) ----------
const WARIANTY = {
  "v1-bycza-ce": {
    nazwa: "Bycza luka z CE",
    pelny: () =>
      defsR4 +
      strefa(232, 300, 114, { styl: "oba" }) +
      `<ellipse cx="256" cy="256" rx="90" ry="190" fill="url(#blaskSwiecy)"/>` +
      swieca(150, 72, 300, 324, 404, 432, "stal") +
      swieca(256, 86, 84, 114, 392, 424, "zloto") +
      swieca(362, 72, 80, 104, 208, 232, "stal"),
    // favicon 32: świeca środkowa złota, boczne stalowe, luka jako mocne złote pasmo z krawędziami
    maly: () => `<rect x="4" y="13" width="25" height="5" fill="${A}" fill-opacity=".42"/>
<rect x="4" y="12.5" width="25" height="1" fill="${A}"/><rect x="4" y="17.5" width="25" height="1" fill="${A}"/>
<rect x="7" y="18" width="1.6" height="11" rx=".8" fill="#8c99a7"/><rect x="5" y="20" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="24.4" y="3" width="1.6" height="10" rx=".8" fill="#8c99a7"/><rect x="22.4" y="5" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="15.2" y="2.5" width="1.6" height="27" rx=".8" fill="url(#z)"/><rect x="12.6" y="5" width="6.8" height="22.5" rx="1.2" fill="url(#z)"/>`,
  },
  "v2-niedzwiedzia-ce": {
    nazwa: "Niedźwiedzia luka z CE",
    pelny: () =>
      defsR4 +
      strefa(212, 280, 114, { styl: "oba" }) +
      `<ellipse cx="256" cy="256" rx="90" ry="190" fill="url(#blaskSwiecy)"/>` +
      swieca(150, 72, 80, 108, 188, 212, "stal") +
      swieca(256, 86, 88, 120, 398, 428, "zloto") +
      swieca(362, 72, 280, 304, 408, 432, "stal"),
    maly: () => `<rect x="4" y="14" width="25" height="5" fill="${A}" fill-opacity=".42"/>
<rect x="4" y="13.5" width="25" height="1" fill="${A}"/><rect x="4" y="18.5" width="25" height="1" fill="${A}"/>
<rect x="7" y="3" width="1.6" height="11" rx=".8" fill="#8c99a7"/><rect x="5" y="5.5" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="24.4" y="19" width="1.6" height="10" rx=".8" fill="#8c99a7"/><rect x="22.4" y="20.5" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="15.2" y="2.5" width="1.6" height="27" rx=".8" fill="url(#z)"/><rect x="12.6" y="4.5" width="6.8" height="23" rx="1.2" fill="url(#z)"/>`,
  },
  "v3-bycza-przerwa": {
    nazwa: "Bycza luka jako przerwa",
    pelny: () =>
      defsR4 +
      strefa(232, 300, 114, { ce: false, styl: "kreski" }) +
      `<ellipse cx="256" cy="256" rx="90" ry="190" fill="url(#blaskSwiecy)"/>` +
      swieca(150, 72, 300, 324, 404, 432, "stal") +
      swieca(256, 86, 84, 114, 392, 424, "zloto") +
      swieca(362, 72, 80, 104, 208, 232, "stal"),
    maly: () => `<rect x="4" y="12.5" width="25" height="1.2" fill="${A}"/><rect x="4" y="17.3" width="25" height="1.2" fill="${A}"/>
<rect x="7" y="18.5" width="1.6" height="10.5" rx=".8" fill="#8c99a7"/><rect x="5" y="20" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="24.4" y="3" width="1.6" height="9.5" rx=".8" fill="#8c99a7"/><rect x="22.4" y="5" width="5.6" height="6.5" rx="1" fill="#a9b4bf"/>
<rect x="15.2" y="2.5" width="1.6" height="27" rx=".8" fill="url(#z)"/><rect x="12.6" y="5" width="6.8" height="22.5" rx="1.2" fill="url(#z)"/>`,
  },
};

const favKafel = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="z" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c98a35"/><stop offset=".45" stop-color="#fcd593"/><stop offset="1" stop-color="#c47f2c"/></linearGradient></defs>
<rect width="32" height="32" rx="7" fill="${BG}"/><rect x=".5" y=".5" width="31" height="31" rx="6.5" fill="none" stroke="#35404d"/>
${t}
</svg>
`;
const glifSvg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 1.5 29 29">
<defs><linearGradient id="z" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c98a35"/><stop offset=".45" stop-color="#fcd593"/><stop offset="1" stop-color="#c47f2c"/></linearGradient></defs>
${t}
</svg>
`;

// ---------- render ----------
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svgText, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svgText.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [k, v] of Object.entries(WARIANTY)) {
  const dir = join(ROOT, k);
  mkdirSync(dir, { recursive: true });
  const pelny = kafel(v.pelny(), { skala: 0.9 });
  const mask = kafel(v.pelny(), { pelne: true, skala: 0.72 });
  const apple = kafel(v.pelny(), { pelne: true, skala: 0.84 });
  const fav = favKafel(v.maly());
  writeFileSync(join(dir, "icon-dark.svg"), pelny);
  writeFileSync(join(dir, "icon-maskable.svg"), mask);
  writeFileSync(join(dir, "apple-touch-icon.svg"), apple);
  writeFileSync(join(dir, "favicon.svg"), fav);
  writeFileSync(join(dir, "glif.svg"), glifSvg(v.maly()));
  await png(fav, 16, join(dir, "favicon-16.png"));
  await png(fav, 32, join(dir, "favicon-32.png"));
  await png(apple, 180, join(dir, "apple-touch-icon-180.png"));
  await png(pelny, 192, join(dir, "icon-192.png"));
  await png(pelny, 512, join(dir, "icon-512.png"));
  await png(mask, 192, join(dir, "icon-maskable-192.png"));
  await png(mask, 512, join(dir, "icon-maskable-512.png"));
}

// ---------- plansza ----------
const css = readFileSync(resolve("docs/design/znak/runda-3/plansza.html"), "utf8").match(/<style>[\s\S]*?<\/style>/)[0];
const kontekst = (k) => `<div class="dol">
  <div class="karta"><p class="etykieta">Karta przeglądarki</p>
    <div class="pasek ciemny"><div class="zakladki"><div class="zakladka aktywna"><img src="${k}/favicon.svg" alt="">Dziś · Dziennik</div><div class="zakladka"><i></i>TradingView</div></div></div>
    <div class="pasek jasny"><div class="zakladki"><div class="zakladka aktywna"><img src="${k}/favicon.svg" alt="">Dziś · Dziennik</div><div class="zakladka"><i></i>TradingView</div></div></div>
    <p class="etykieta" style="margin-top:16px">Maskable (Android)</p>
    <div class="maski"><img class="kolo" src="${k}/icon-maskable-192.png" alt=""><img class="squircle" src="${k}/icon-maskable-192.png" alt=""><img class="kropla" src="${k}/icon-maskable-192.png" alt=""></div>
  </div>
  <div class="karta"><p class="etykieta">Ekran główny telefonu</p>
    <div class="telefon">
      <div class="apka"><span class="a1"></span>Poczta</div><div class="apka"><img src="${k}/icon-maskable-192.png" alt="">Dziennik</div><div class="apka"><span class="a2"></span>Bank</div><div class="apka"><span class="a5"></span>Zdjęcia</div>
      <div class="apka"><span class="a3"></span>Kalendarz</div><div class="apka"><span class="a6"></span>Ustawienia</div><div class="apka"><span class="a4"></span>Muzyka</div><div class="apka"><span class="a7"></span>Notatki</div>
    </div>
  </div>
  <div class="app">
    <div class="sidebar"><div class="logo"><img src="${k}/glif.svg" alt="">Dziennik</div><div class="nav aktywny">Dziś</div><div class="nav">Trade'y</div><div class="nav">Prop</div><div class="nav">Mózg</div></div>
    <div class="tresc"><h2>Dziś</h2><span class="pigulka glowna">Przed sesją</span><span class="pigulka">Po sesji</span><div class="liczba">+1,8 R</div><p class="roboczy">tekst roboczy</p></div>
  </div>
  <div class="karta logowanie"><p class="etykieta">Ekran logowania</p><img src="${k}/icon-512.png" width="96" height="96" alt=""><p class="lt">Dziennik</p><div class="pole"></div><div class="pole"></div><div class="przycisk">Zaloguj</div></div>
</div>`;

const rozmiary = (k) => `<div class="rozmiary">
  <figure><img src="${k}/apple-touch-icon-180.png" width="90" height="90" class="ios" alt="">180 iOS</figure>
  <figure><img src="${k}/icon-192.png" width="64" height="64" alt="">192</figure>
  <figure><img src="${k}/favicon.svg" width="48" height="48" alt="">favicon 48</figure>
  <figure><img src="${k}/favicon-32.png" width="32" height="32" alt="">32</figure>
  <figure><img src="${k}/favicon-16.png" width="16" height="16" alt="">16</figure>
  <figure><img class="piksele" src="${k}/favicon-16.png" alt="">16 ×4</figure>
</div>`;

const rek = OCENY.rekomendacja;
const pozostale = Object.keys(WARIANTY).filter((k) => k !== rek);
const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Znak dziennika: runda 4, FVG</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
${css}
<style>
.warianty{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.warianty .karta img.w{width:100%;height:auto;display:block;border-radius:8px;margin-bottom:14px}
.warianty .rozmiary{gap:14px;margin-top:12px}
.rek{font:500 10px "IBM Plex Mono",monospace;color:var(--bg);background:var(--accent);padding:2px 8px;border-radius:999px;vertical-align:3px;margin-left:6px}
</style></head><body><main>
<h1>Znak dziennika: runda 4, FVG</h1>
<p class="lead">Wybór użytkownika z rundy 3: szkic 2, FVG. Trzy warianty kompozycji, ten sam detal: metal z refleksem na świecach, knoty z obu stron, siatka wykresu 4%, cień i poświata. Każdy ma osobny favicon 16–32 px, który dalej czyta się jako luka. Tło #0b0e12, akcent #e8a44c. „Dziennik” to nazwa robocza (tekst roboczy).</p>
<h2 class="sekcja">3 warianty kompozycji</h2>
<div class="warianty">${Object.entries(WARIANTY)
  .map(
    ([k, v]) => `<div class="karta"${k === rek ? ' style="border-color:rgb(232 164 76 / .6)"' : ""}><img class="w" src="${k}/icon-512.png" alt="">
<p class="nazwa" style="font-size:18px">${v.nazwa}${k === rek ? '<span class="rek">rekomendacja</span>' : ""}</p><p class="opis" style="font-size:13.5px">${OCENY.warianty[k]}</p>
${rozmiary(k)}</div>`
  )
  .join("")}</div>
<h2 class="sekcja">Rekomendacja: ${WARIANTY[rek].nazwa}</h2>
<section class="final">
<div class="gora">
  <img class="wielki" src="${rek}/icon-512.png" width="512" height="512" alt="">
  <div class="opisf">
    <p class="etykieta">Pełny znak 512 px</p>
    <p class="nazwa">${WARIANTY[rek].nazwa}</p>
    <p class="opis">${OCENY.zdanie}</p>
    <p class="ocena"><b>${OCENY.ocena}/10.</b> ${OCENY.luka}</p>
    <p class="ocena"><b>Poprawione przed pokazaniem:</b> ${OCENY.poprawki}</p>
    <p class="etykieta" style="margin-top:24px">Dwa poziomy: pełny znak i favicon z tej samej rodziny</p>
    ${rozmiary(rek)}
    <p class="etykieta" style="margin-top:24px">Favicon w powiększeniu (siatka 32)</p>
    <img src="${rek}/favicon.svg" width="192" height="192" alt="">
  </div>
</div>
${kontekst(rek)}
</section>
<h2 class="sekcja">Pozostałe warianty w kontekstach</h2>
${pozostale.map((k) => `<p class="etykieta">${WARIANTY[k].nazwa}</p>${kontekst(k)}<div style="height:28px"></div>`).join("")}
<p class="stopka">${OCENY.stopka}</p>
</main></body></html>`;
writeFileSync(join(ROOT, "plansza.html"), html);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(pathToFileURL(join(ROOT, "plansza.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "plansza.png"), fullPage: true });
await browser.close();
console.log("gotowe");
