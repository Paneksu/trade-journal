// Runda 2 znaku dziennika: 10 szkiców + 3 dopracowane finały (SVG, PNG, plansza).
// Uruchomienie z katalogu projektu: node docs/audyt/robocze/generuj-znak-r2.mjs
// Tożsamość z src/app/globals.css: tło #0b0e12, akcent #e8a44c (jasny #f5b968),
// tekst #e7ecf1. Ciemniejszy koniec gradientu akcentu #d68a2e to pochodna akcentu
// (ten sam odcień, niższa jasność), nie nowy kolor marki.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve("docs/design/znak/runda-2");
const BG = "#0b0e12";
const A = "#e8a44c";
const A_HI = "#f5b968";
const A_LO = "#d68a2e";
const TEXT = "#e7ecf1";
const EDGE = "#35404d";

// ---------- geometria (siatka 64 x 64, środek 32,32) ----------
// półkole: środek (cx,cy), promień r, góra (up=true) albo dół
const pol = (cx, cy, r, up) =>
  up
    ? `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`
    : `M${cx - r} ${cy}A${r} ${r} 0 0 0 ${cx + r} ${cy}Z`;

// Każdy glif: funkcja (f1, f2) -> SVG; f1 = wypełnienie główne, f2 = drugie (przygaszone albo jasne).
const SZKICE = {
  s01: {
    nazwa: "Przesunięcie",
    idea: "Krążek przecięty na poziomie, połowy rozsunięte: luka (FVG) i przemieszczenie.",
    glif: (f1, f2) =>
      `<path d="${pol(35, 30, 18, true)}" fill="${f1}"/><path d="${pol(29, 34, 18, false)}" fill="${f1}"/>`,
  },
  s02: {
    nazwa: "Równowaga",
    idea: "Krążek z linią 50%: dół pełny, góra przygaszona, premium i discount.",
    glif: (f1, f2) =>
      `<path d="${pol(32, 30, 20, true)}" fill="${f2}"/><path d="${pol(32, 34, 20, false)}" fill="${f1}"/>`,
  },
  s03: {
    nazwa: "Karta",
    idea: "Strona dziennika z zagiętym rogiem i jedną szczeliną wpisu.",
    glif: (f1) =>
      `<path fill-rule="evenodd" fill="${f1}" d="M17 10h21l11 11v31a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2Zm4 26h22v4H21Z"/>`,
  },
  s04: {
    nazwa: "Księga",
    idea: "Trzy wpisy jeden pod drugim, środkowy pełny: rejestr dnia.",
    glif: (f1, f2) =>
      `<rect x="14" y="13" width="36" height="10" rx="5" fill="${f2}"/><rect x="14" y="27" width="36" height="10" rx="5" fill="${f1}"/><rect x="14" y="41" width="24" height="10" rx="5" fill="${f2}"/>`,
  },
  s05: {
    nazwa: "Klepsydra",
    idea: "Dwa trójkąty czubkami do siebie: czas sesji i cierpliwość.",
    glif: (f1, f2) =>
      `<path d="M14 11h36L32 29Z" fill="${f1}" stroke="${f1}" stroke-width="3" stroke-linejoin="round"/><path d="M32 35l18 18H14Z" fill="${f2}" stroke="${f2}" stroke-width="3" stroke-linejoin="round"/>`,
  },
  s06: {
    nazwa: "Romb",
    idea: "Romb rozcięty na poziomie: zakres z linią równowagi, ostry jak decyzja.",
    glif: (f1, f2) =>
      `<path d="M32 10l21 20H11Z" fill="${f1}" stroke="${f1}" stroke-width="3" stroke-linejoin="round"/><path d="M11 34h42L32 54Z" fill="${f2}" stroke="${f2}" stroke-width="3" stroke-linejoin="round"/>`,
  },
  s07: {
    nazwa: "Horyzont",
    idea: "Półkole nad poziomą kreską: otwarcie sesji nad poziomem.",
    glif: (f1, f2) =>
      `<path d="${pol(32, 36, 18, true)}" fill="${f1}"/><rect x="10" y="40" width="44" height="6" rx="3" fill="${f2}"/>`,
  },
  s08: {
    nazwa: "Narożniki",
    idea: "Dwa narożniki zakresu, górny w akcencie: ramka dnia.",
    glif: (f1, f2) =>
      `<path d="M12 30V16a4 4 0 0 1 4-4h14" fill="none" stroke="${f1}" stroke-width="7" stroke-linecap="round"/><path d="M52 34v14a4 4 0 0 1-4 4H34" fill="none" stroke="${f2}" stroke-width="7" stroke-linecap="round"/>`,
  },
  s09: {
    nazwa: "Teta",
    idea: "Pierścień przecięty poziomem wychodzącym poza obrys.",
    glif: (f1) =>
      `<circle cx="32" cy="32" r="17" fill="none" stroke="${f1}" stroke-width="6"/><rect x="6" y="29" width="52" height="6" rx="3" fill="${f1}"/>`,
  },
  s10: {
    nazwa: "Sierp",
    idea: "Krążek z wyciętym kołem: sesja azjatycka, noc przed otwarciem.",
    glif: (f1) =>
      `<path fill-rule="evenodd" fill="${f1}" d="M12 32a20 20 0 1 0 40 0a20 20 0 1 0-40 0ZM30 23a12 12 0 1 0 24 0a12 12 0 1 0-24 0Z"/>`,
  },
};

// ---------- finały: dopracowana geometria ----------
// Poprawki optyczne: krążki o 1 jednostkę większe od kwadratów (wyrównanie optyczne),
// środek ciężkości 1 jednostkę nad środkiem geometrycznym, luka 4 jednostki = 1 px przy 16 px.
const FINALY = {
  "f1-przesuniecie": {
    nazwa: "Przesunięcie",
    zrodlo: "s01",
    zdanie:
      "Krążek przecięty poziomą luką, górna połowa przesunięta w prawo: luka i przemieszczenie z ICT, jedna pełna forma w akcencie.",
    // obrys w kolorze wypełnienia zaokrągla rogi cięciwy o 1 jednostkę (rogi nie kłują)
    glif: (f1) =>
      `<g fill="${f1}" stroke="${f1}" stroke-width="2" stroke-linejoin="round"><path d="${pol(37, 29.5, 17.5, true)}"/><path d="${pol(27, 34.5, 17.5, false)}"/></g>`,
    // wersja na 16-32 px: większa luka i przesunięcie, żeby nie zlały się w kleks
    maly: (f1) =>
      `<path d="${pol(37, 29, 20, true)}" fill="${f1}"/><path d="${pol(27, 35, 20, false)}" fill="${f1}"/>`,
  },
  "f2-zakres": {
    nazwa: "Zakres",
    zrodlo: "s06",
    zdanie:
      "Romb od szczytu do dołka rozcięty linią równowagi, połowy przesunięte: zakres dnia i przemieszczenie w ostrej, pełnej bryle.",
    glif: (f1) =>
      `<g fill="${f1}" stroke="${f1}" stroke-width="3" stroke-linejoin="round"><path d="M35.5 11.5L54.5 29.5H16.5Z"/><path d="M9.5 34.5H47.5L28.5 52.5Z"/></g>`,
    maly: (f1) =>
      `<g fill="${f1}" stroke="${f1}" stroke-width="2" stroke-linejoin="round"><path d="M35 8L58 29H12Z"/><path d="M6 35H52L29 56Z"/></g>`,
  },
  "f3-horyzont": {
    nazwa: "Horyzont",
    zrodlo: "s07",
    zdanie:
      "Pełne półkole w akcencie wschodzące nad jasnym poziomem: otwarcie sesji nad zaznaczonym poziomem, plan przed wejściem.",
    glif: (f1, f2) =>
      `<g fill="${f1}" stroke="${f1}" stroke-width="2" stroke-linejoin="round"><path d="${pol(32, 36.5, 17.5, true)}"/></g><rect x="12" y="41" width="40" height="5" rx="2.5" fill="${f2}" fill-opacity=".92"/>`,
    maly: (f1, f2) =>
      `<path d="${pol(32, 34, 21, true)}" fill="${f1}"/><rect x="8" y="40" width="48" height="7" rx="2" fill="${f2}"/>`,
  },
};

// ---------- kafle ----------
const defs = (id) => `<defs>
<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b212a"/><stop offset=".55" stop-color="#10141a"/><stop offset="1" stop-color="${BG}"/></linearGradient>
<linearGradient id="${id}a" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="54"><stop offset="0" stop-color="${A_HI}"/><stop offset=".6" stop-color="${A}"/><stop offset="1" stop-color="${A_LO}"/></linearGradient>
<linearGradient id="${id}d" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="54"><stop offset="0" stop-color="${A}" stop-opacity=".42"/><stop offset="1" stop-color="${A}" stop-opacity=".26"/></linearGradient>
<radialGradient id="${id}g" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="${A}" stop-opacity=".16"/><stop offset="1" stop-color="${A}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>`;

const svg = (inner, vb = "0 0 64 64") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">\n${inner}\n</svg>\n`;

const skala = (g, s) =>
  s === 1 ? g : `<g transform="translate(32 32) scale(${s}) translate(-32 -32)">${g}</g>`;

// Ikona aplikacji: kafel z gradientem tła, poświata akcentu, obwódka-światło u góry.
function ikona(glif, { pelne = false, s = 1, id = "k", drugi = "dim" } = {}) {
  const f2 = drugi === "text" ? TEXT : `url(#${id}d)`;
  const ksztalt = pelne ? `width="64" height="64"` : `width="64" height="64" rx="14"`;
  const ramka = pelne
    ? ""
    : `<rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="url(#${id}h)"/>`;
  return svg(`${defs(id)}
<rect ${ksztalt} fill="url(#${id}t)"/>
<rect ${ksztalt} fill="url(#${id}g)"/>
${ramka}
${skala(glif(`url(#${id}a)`, f2), s)}`);
}

// Favicon: płaski kafel (gradient nic nie daje przy 16 px), ramka 1 px na ciemny pasek kart.
function favicon(glifMaly, drugi = "dim") {
  const f2 = drugi === "text" ? TEXT : "#6b4d26"; // przygaszony akcent: akcent 42% na tle #0b0e12
  return svg(`<rect width="64" height="64" rx="14" fill="${BG}"/>
<rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${EDGE}" stroke-width="2"/>
${glifMaly(A, f2)}`);
}

// Sam glif do nagłówka aplikacji (bez kafla, płaski).
const glifPlaski = (g, drugi = "dim") =>
  svg(g(A, drugi === "text" ? TEXT : "#6b4d26"), "6 6 52 52");

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

// Szkice
const dirS = join(ROOT, "szkice");
mkdirSync(dirS, { recursive: true });
for (const [k, z] of Object.entries(SZKICE)) {
  writeFileSync(join(dirS, `${k}.svg`), ikona(z.glif, { id: k }));
  writeFileSync(join(dirS, `${k}-16.svg`), favicon(z.glif));
  await png(favicon(z.glif), 16, join(dirS, `${k}-16.png`));
}

// Finały
const DRUGI = { "f1-przesuniecie": "dim", "f2-zakres": "dim", "f3-horyzont": "text" };
for (const [k, z] of Object.entries(FINALY)) {
  const dir = join(ROOT, k);
  mkdirSync(dir, { recursive: true });
  const d = DRUGI[k];
  const app = ikona(z.glif, { id: "i", drugi: d });
  const mask = ikona(z.glif, { id: "m", pelne: true, s: 0.8, drugi: d });
  const apple = ikona(z.glif, { id: "p", pelne: true, s: 0.92, drugi: d });
  const fav = favicon(z.maly, d);
  writeFileSync(join(dir, "favicon.svg"), fav);
  writeFileSync(join(dir, "icon-dark.svg"), app);
  writeFileSync(join(dir, "icon-maskable.svg"), mask);
  writeFileSync(join(dir, "apple-touch-icon.svg"), apple);
  writeFileSync(join(dir, "glif.svg"), glifPlaski(z.maly, d));
  await png(fav, 16, join(dir, "favicon-16.png"));
  await png(fav, 32, join(dir, "favicon-32.png"));
  await png(apple, 180, join(dir, "apple-touch-icon-180.png"));
  await png(app, 192, join(dir, "icon-192.png"));
  await png(app, 512, join(dir, "icon-512.png"));
  await png(mask, 192, join(dir, "icon-maskable-192.png"));
  await png(mask, 512, join(dir, "icon-maskable-512.png"));
}

// Plansza (HTML budowany tutaj, żeby szkice i finały zawsze zgadzały się z plikami)
const OCENY = JSON.parse(
  (await import("node:fs")).readFileSync(new URL("./znak-r2-oceny.json", import.meta.url), "utf8")
);
const szkiceHtml = Object.entries(SZKICE)
  .map(
    ([k, z], i) => `<figure class="szkic${OCENY.wybrane.includes(k) ? " wybrany" : ""}">
  <img class="sz-duzy" src="szkice/${k}.svg" alt="">
  <div class="sz-male"><img src="szkice/${k}-16.png" width="16" height="16" alt=""><img class="piksele" src="szkice/${k}-16.png" alt=""></div>
  <figcaption><b>${i + 1}. ${z.nazwa}</b>${OCENY.wybrane.includes(k) ? ' <span class="znacznik">do finału</span>' : ""}<br>${z.idea}<br><span class="werdykt">${OCENY.szkice[k]}</span></figcaption>
</figure>`
  )
  .join("\n");

const finalHtml = Object.entries(FINALY)
  .map(([k, z], i) => {
    const o = OCENY.finaly[k];
    return `<section class="final">
  <div class="karta glowna">
    <p class="etykieta">Finał ${String.fromCharCode(65 + i)} · ze szkicu ${z.zrodlo.slice(1).replace(/^0/, "")}</p>
    <p class="nazwa">${z.nazwa}</p>
    <p class="opis">${z.zdanie}</p>
    <img class="duzy" src="${k}/icon-512.png" alt="">
    <p class="ocena"><b>${o.ocena}/10.</b> ${o.luka}</p>
    <p class="ocena"><b>Poprawione po ocenie:</b> ${o.poprawki}</p>
  </div>
  <div class="karta">
    <p class="etykieta">Rozmiary</p>
    <div class="rozmiary">
      <figure><img src="${k}/icon-192.png" width="96" height="96" alt="">512 / 192</figure>
      <figure><img class="ios" src="${k}/apple-touch-icon-180.png" width="60" height="60" alt="">180 iOS</figure>
    </div>
    <div class="rozmiary">
      <figure><img src="${k}/favicon-32.png" width="32" height="32" alt="">32</figure>
      <figure><img src="${k}/favicon-16.png" width="16" height="16" alt="">16</figure>
      <figure><img class="piksele" src="${k}/favicon-16.png" alt="">16 ×4</figure>
    </div>
    <p class="etykieta" style="margin-top:20px">Maskable (Android)</p>
    <div class="maski"><img class="kolo" src="${k}/icon-maskable.svg" alt=""><img class="squircle" src="${k}/icon-maskable.svg" alt=""><img class="kropla" src="${k}/icon-maskable.svg" alt=""></div>
  </div>
  <div class="karta">
    <p class="etykieta">Karta przeglądarki</p>
    <div class="pasek ciemny"><div class="zakladki"><div class="zakladka aktywna"><img src="${k}/favicon.svg" alt="">Dziś · Dziennik</div><div class="zakladka"><i></i>TradingView</div></div></div>
    <div class="pasek jasny"><div class="zakladki"><div class="zakladka aktywna"><img src="${k}/favicon.svg" alt="">Dziś · Dziennik</div><div class="zakladka"><i></i>TradingView</div></div></div>
    <p class="etykieta" style="margin-top:20px">Ekran główny telefonu</p>
    <div class="telefon">
      <div class="apka"><span class="a1"></span>Poczta</div><div class="apka"><img src="${k}/icon-maskable.svg" alt="">Dziennik</div><div class="apka"><span class="a2"></span>Bank</div><div class="apka"><span class="a5"></span>Zdjęcia</div>
      <div class="apka"><span class="a3"></span>Kalendarz</div><div class="apka"><span class="a6"></span>Ustawienia</div><div class="apka"><span class="a4"></span>Muzyka</div><div class="apka"><span class="a7"></span>Notatki</div>
    </div>
  </div>
  <div class="app">
    <div class="sidebar"><div class="logo"><img src="${k}/glif.svg" alt="">Dziennik</div><div class="nav aktywny">Dziś</div><div class="nav">Trade'y</div><div class="nav">Prop</div><div class="nav">Mózg</div></div>
    <div class="tresc"><h2>Dziś</h2><span class="pigulka glowna">Przed sesją</span><span class="pigulka">Po sesji</span><div class="liczba">+1,8 R</div><p class="roboczy">tekst roboczy</p></div>
  </div>
</section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Znak dziennika: runda 2</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0e12;--surface:#12161c;--surface-2:#191f26;--line:#262e38;--line-strong:#35404d;--text:#e7ecf1;--muted:#97a3b0;--faint:#838f9d;--accent:#e8a44c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "IBM Plex Sans",sans-serif}
main{width:1440px;padding:48px 56px 64px}
h1{font-size:28px;line-height:36px;font-weight:600;margin:0 0 4px}
h2.sekcja{font-size:20px;line-height:28px;font-weight:600;margin:48px 0 16px}
.lead{color:var(--muted);margin:0 0 24px;max-width:960px}
.karta{background:var(--surface);border:1px solid rgb(255 255 255 / .12);border-radius:12px;padding:24px}
.etykieta{font:500 11px/16px "IBM Plex Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:0 0 12px}
.zasady{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.zasady .karta{padding:18px}.zasady b{display:block;margin-bottom:4px;font-weight:600}.zasady p{margin:0;color:var(--muted);font-size:13px}
.szkice{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.szkic{margin:0;background:var(--surface);border:1px solid rgb(255 255 255 / .12);border-radius:12px;padding:18px}
.szkic.wybrany{border-color:rgb(232 164 76 / .55)}
.sz-duzy{width:112px;height:112px;display:block}
.sz-male{display:flex;align-items:flex-end;gap:12px;margin:12px 0}
.szkic figcaption{font-size:12.5px;color:var(--muted);line-height:1.45}.szkic b{color:var(--text);font-weight:600;font-size:14px}
.werdykt{display:block;margin-top:6px;color:var(--faint);font-family:"IBM Plex Mono",monospace;font-size:11px;line-height:1.5}
.znacznik{font:500 10px "IBM Plex Mono",monospace;color:var(--bg);background:var(--accent);padding:1px 6px;border-radius:999px;vertical-align:2px}
.piksele{image-rendering:pixelated;width:64px;height:64px}
.final{display:grid;grid-template-columns:400px 230px 300px 1fr;gap:20px;margin-bottom:24px;align-items:start}
.nazwa{font-size:20px;font-weight:600;margin:0 0 8px}.opis{color:var(--muted);margin:0}
.duzy{width:240px;height:240px;display:block;margin:20px 0 16px}
.ocena{font-size:13px;color:var(--muted);margin:8px 0 0}.ocena b{color:var(--text);font-weight:600}
.rozmiary{display:flex;gap:14px;align-items:flex-end;margin-bottom:12px}
.rozmiary figure{margin:0;text-align:center;font:11px "IBM Plex Mono",monospace;color:var(--faint)}
.rozmiary img{display:block;margin:0 auto 6px}.ios{border-radius:13px}
.maski{display:flex;gap:12px}.maski img{width:48px;height:48px;display:block}
.kolo{border-radius:50%}.squircle{border-radius:22%}.kropla{border-radius:50% 50% 50% 12%}
.pasek{border-radius:8px;padding:8px 8px 0;margin-bottom:12px}.pasek.ciemny{background:#1f2329}.pasek.jasny{background:#dfe3e8}
.zakladki{display:flex;gap:2px}.zakladka{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:8px 8px 0 0;font-size:12px;width:128px;white-space:nowrap;overflow:hidden}
.ciemny .zakladka{color:#9aa3ad}.ciemny .zakladka.aktywna{background:#35393f;color:#e8eaed}
.jasny .zakladka{color:#5f6368}.jasny .zakladka.aktywna{background:#fff;color:#202124}
.zakladka i{width:16px;height:16px;border-radius:3px;background:#6b7280;flex:none}.zakladka img{width:16px;height:16px;flex:none}
.telefon{border-radius:24px;padding:22px 16px;background:linear-gradient(160deg,#2a3644,#0f141a 75%);border:1px solid var(--line-strong);display:grid;grid-template-columns:repeat(4,1fr);row-gap:16px}
.apka{text-align:center;font-size:10px;color:#dfe5ea}.apka span,.apka img{display:block;width:46px;height:46px;margin:0 auto 5px;border-radius:12px}
.a1{background:#3b6fd8}.a2{background:#2f9e6a}.a3{background:#d1503e}.a4{background:#8a5cd0}.a5{background:#e1e5ea}.a6{background:#4b5563}.a7{background:#c9862e}
.app{display:grid;grid-template-columns:150px 1fr;height:300px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sidebar{background:#080a0d;padding:16px 10px;border-right:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;padding:2px 8px 16px}.logo img{width:22px;height:22px}
.nav{font-size:13px;color:var(--muted);padding:6px 8px;border-radius:6px}.nav.aktywny{background:var(--surface-2);color:var(--text)}
.tresc{padding:16px 20px}.tresc h2{font-size:22px;line-height:28px;font-weight:600;margin:0 0 12px}
.pigulka{display:inline-block;font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid var(--line-strong);color:var(--muted);margin:0 6px 6px 0}
.pigulka.glowna{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:500}
.liczba{font:500 28px/36px "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;margin-top:16px}
.roboczy{font:11px "IBM Plex Mono",monospace;color:var(--faint);margin-top:6px}
.stopka{color:var(--muted);max-width:1100px;margin-top:24px;font-size:13px}.stopka b{color:var(--text);font-weight:500}
</style></head><body><main>
<h1>Znak dziennika: runda 2</h1>
<p class="lead">Najpierw research, potem 10 szkiców w różnych kierunkach, z nich 3 finały dopracowane w wielkości od 16 do 512 px. Tożsamość bez zmian: tło #0b0e12, akcent #e8a44c. „Dziennik” to nazwa robocza (tekst roboczy).</p>
<p class="etykieta">Co sprawia, że znaki Mercury, Linear, Raycast, Arc i Things są ładne</p>
<div class="zasady">${OCENY.zasady.map((z) => `<div class="karta"><b>${z[0]}</b><p>${z[1]}</p></div>`).join("")}</div>
<h2 class="sekcja">10 szkiców</h2>
<p class="lead">Każdy szkic jako ikona aplikacji (112 px) i jako favicon w rzeczywistych 16 px, obok powiększony 4 razy. Obwódka w akcencie oznacza szkice, które przeszły do finału.</p>
<div class="szkice">${szkiceHtml}</div>
<h2 class="sekcja">3 finały</h2>
${finalHtml}
<p class="stopka">${OCENY.stopka}</p>
</main></body></html>`;
writeFileSync(join(ROOT, "plansza.html"), html);

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(pathToFileURL(join(ROOT, "plansza.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "plansza.png"), fullPage: true });
await browser.close();
console.log("gotowe");
