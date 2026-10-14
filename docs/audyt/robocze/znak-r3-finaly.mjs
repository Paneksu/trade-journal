// Runda 3: trzy dopracowane finały (pełny znak 180–512 px + favicon 16–32 px) i plansza.
import { readFileSync } from "node:fs";
import { swieca, NQ, A, BG, TEXT, ZYSK, STRATA } from "./znak-r3-szkice.mjs";

export const OCENY = JSON.parse(readFileSync(new URL("./znak-r3-oceny.json", import.meta.url), "utf8"));

// Favicon: płaski kafel 32 x 32, ramka #35404d, rysunek uproszczony z tej samej rodziny.
const favKafel = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="z" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c47c"/><stop offset="1" stop-color="#d48a35"/></linearGradient></defs>
<rect width="32" height="32" rx="7" fill="${BG}"/><rect x=".5" y=".5" width="31" height="31" rx="6.5" fill="none" stroke="#35404d"/>
${t}
</svg>
`;
const glifSvg = (t, vb = "2 2 28 28") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
<defs><linearGradient id="z" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c47c"/><stop offset="1" stop-color="#d48a35"/></linearGradient></defs>
${t}
</svg>
`;

// ---------- F1 Herb ----------
const herbMaly = `<path d="M16 3.2L26.6 6.6V15C26.6 21.6 22 25.8 16 28.6C10 25.8 5.4 21.6 5.4 15V6.6Z" fill="#141920" stroke="url(#z)" stroke-width="2.4" stroke-linejoin="round"/>
<rect x="10.5" y="15" width="4" height="7.5" rx=".8" fill="url(#z)"/><rect x="12" y="13" width="1" height="11" fill="url(#z)"/>
<rect x="17.5" y="10" width="4" height="8.5" rx=".8" fill="url(#z)"/><rect x="19" y="8" width="1" height="13" fill="url(#z)"/>`;

function herb() {
  return `<path d="M256 70L420 120V256C420 356 348 414 256 446C164 414 92 356 92 256V120Z" fill="url(#strona)" stroke="url(#metal)" stroke-width="16" stroke-linejoin="round"/>
<path d="M256 98L394 140V256C394 340 334 390 256 418C178 390 118 340 118 256V140Z" fill="none" stroke="${A}" stroke-opacity=".55" stroke-width="3"/>
<path d="M118 140L256 98L394 140V196H118Z" fill="#0b0e12" fill-opacity=".45"/>
<path d="M118 196H394" stroke="url(#metal)" stroke-width="6"/>
<path d="M118 204H394" stroke="${A}" stroke-opacity=".35" stroke-width="2"/>
${NQ(203, 128, 52, 13)}
<circle cx="150" cy="156" r="5" fill="${A}" fill-opacity=".7"/><circle cx="362" cy="156" r="5" fill="${A}" fill-opacity=".7"/>
<path d="M140 300H372" stroke="${TEXT}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="8 7"/>
${swieca(188, 44, 292, 316, 384, 402)}${swieca(256, 44, 244, 266, 362, 384)}${swieca(324, 44, 214, 232, 330, 352)}
<path d="M104 128L256 82L408 128" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2"/>`;
}

// ---------- F2 Świeca-dziennik ----------
const swiecaMala = `<rect x="15" y="3" width="2" height="6" rx="1" fill="url(#z)"/><rect x="15" y="24" width="2" height="5" rx="1" fill="url(#z)"/>
<rect x="9.5" y="7.5" width="13" height="17.5" rx="2" fill="url(#z)"/>
<path d="M13 12.5H20M13 16.5H20M13 20.5H18" stroke="#5a3a14" stroke-width="1.4" stroke-linecap="round"/>`;

function swiecaDziennik() {
  let k = "";
  for (let i = 0; i < 6; i++) {
    const y = 158 + i * 40;
    k += `<rect x="170" y="${y}" width="34" height="14" rx="7" fill="${BG}" fill-opacity=".6"/><rect x="160" y="${y + 2}" width="26" height="10" rx="5" fill="url(#stal)"/><rect x="163" y="${y + 3}" width="18" height="2.5" rx="1.2" fill="#fff" fill-opacity=".5"/>`;
  }
  let l = "";
  const dl = [124, 124, 96, 124, 70];
  for (let i = 0; i < 5; i++) {
    const y = 184 + i * 42;
    l += `<path d="M218 ${y}h${dl[i]}" stroke="#6b4214" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/><path d="M218 ${y + 4}h${dl[i]}" stroke="#fde2ae" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>`;
  }
  return `<rect x="244" y="60" width="24" height="80" rx="12" fill="url(#metal)"/><rect x="244" y="390" width="24" height="62" rx="12" fill="url(#metal)"/>
<rect x="172" y="128" width="172" height="270" rx="24" fill="url(#metal)"/>
<rect x="172" y="128" width="172" height="270" rx="24" fill="none" stroke="#fde2ae" stroke-opacity=".35" stroke-width="2"/>
<rect x="184" y="134" width="148" height="5" rx="2.5" fill="#fff" fill-opacity=".45"/>
${l}
<path d="M304 128h18v84l-9-9-9 9Z" fill="#6b4214"/><path d="M306 128h3v80l-3 3Z" fill="#fde2ae" fill-opacity=".35"/>
<path d="M300 352l12 12 22-26" fill="none" stroke="${ZYSK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
${k}`;
}

// ---------- F3 Otwarty dziennik ----------
const ksiegaMala = `<path d="M3 9.5Q9 7.5 15.2 10V26Q9 23.8 3 25.5Z" fill="url(#z)"/><path d="M29 9.5Q23 7.5 16.8 10V26Q23 23.8 29 25.5Z" fill="url(#z)"/>
<path d="M6 13.5Q9.5 12.6 12.5 13.8M6 17Q9.5 16.1 12.5 17.3M6 20.5Q9 19.8 11 20.6" fill="none" stroke="#5a3a14" stroke-width="1.2" stroke-linecap="round"/>
<rect x="21.5" y="12.5" width="3.4" height="7.5" rx=".6" fill="#14312a"/><rect x="22.7" y="10.5" width="1" height="11.5" fill="#14312a"/>`;

function ksiega() {
  return `<path d="M76 196Q166 168 256 202V432Q166 402 76 426Z" fill="#7a4c18"/>
<path d="M436 196Q346 168 256 202V432Q346 402 436 426Z" fill="#7a4c18"/>
<path d="M80 184Q166 156 256 190V420Q166 392 80 414Z" fill="url(#zloto)" fill-opacity=".9"/>
<path d="M432 184Q346 156 256 190V420Q346 392 432 414Z" fill="url(#zloto)" fill-opacity=".9"/>
<path d="M88 170Q168 144 252 178V408Q168 380 88 400Z" fill="url(#strona)" stroke="url(#metal)" stroke-width="6" stroke-linejoin="round"/>
<path d="M424 170Q344 144 260 178V408Q344 380 424 400Z" fill="url(#strona)" stroke="url(#metal)" stroke-width="6" stroke-linejoin="round"/>
<path d="M112 214Q170 198 228 218M112 252Q170 236 228 256M112 290Q170 274 228 294M112 328Q160 314 204 330" fill="none" stroke="${A}" stroke-opacity=".6" stroke-width="6" stroke-linecap="round"/>
<path d="M112 366Q140 358 164 366" fill="none" stroke="${ZYSK}" stroke-opacity=".9" stroke-width="6" stroke-linecap="round"/>
<path d="M276 276Q340 262 404 274" fill="none" stroke="${TEXT}" stroke-opacity=".4" stroke-width="3" stroke-dasharray="8 7"/>
${swieca(302, 30, 262, 288, 350, 372, "url(#czerwien)", "#f08a78")}${swieca(346, 32, 222, 244, 340, 360)}${swieca(390, 30, 176, 196, 282, 304, "url(#zielen)", "#6fd6a8")}
<path d="M252 178Q256 174 260 178V408Q256 412 252 408Z" fill="#0b0e12" fill-opacity=".6"/>
<path d="M268 160h22v76l-11-10-11 10Z" fill="url(#metal)"/>`;
}

export const FINALY = {
  "f1-herb": { nazwa: "Herb", ze: "s06", pelny: herb, favicon: () => favKafel(herbMaly), glif: () => glifSvg(herbMaly) },
  "f2-swieca-dziennik": { nazwa: "Świeca-dziennik", ze: "s09", pelny: swiecaDziennik, favicon: () => favKafel(swiecaMala), glif: () => glifSvg(swiecaMala) },
  "f3-otwarty-dziennik": { nazwa: "Otwarty dziennik", ze: "s05", pelny: ksiega, favicon: () => favKafel(ksiegaMala), glif: () => glifSvg(ksiegaMala, "1 4 30 26") },
};

export function plansza(SZKICE) {
  const sz = Object.entries(SZKICE)
    .map(([k, z], i) => {
      const fin = OCENY.wybrane.includes(k);
      return `<figure class="szkic${fin ? " wybrany" : ""}"><img src="szkice/${k}-256.png" width="150" height="150" alt=""><figcaption><b>${i + 1}. ${z.nazwa}</b>${fin ? ' <span class="znacznik">do finału</span>' : ""}<br>${z.idea}<span class="werdykt">${OCENY.szkice[k]}</span></figcaption></figure>`;
    })
    .join("\n");
  const fin = Object.entries(FINALY)
    .map(([k, f], i) => {
      const o = OCENY.finaly[k];
      return `<section class="final">
<div class="gora">
  <img class="wielki" src="${k}/icon-512.png" width="512" height="512" alt="">
  <div class="opisf">
    <p class="etykieta">Finał ${String.fromCharCode(65 + i)} · ze szkicu ${f.ze.slice(1).replace(/^0/, "")}</p>
    <p class="nazwa">${f.nazwa}</p>
    <p class="opis">${o.zdanie}</p>
    <p class="ocena"><b>${o.ocena}/10.</b> ${o.luka}</p>
    <p class="ocena"><b>Poprawione przed pokazaniem:</b> ${o.poprawki}</p>
    <p class="etykieta" style="margin-top:24px">Dwa poziomy: pełny znak i favicon z tej samej rodziny</p>
    <div class="rozmiary">
      <figure><img src="${k}/apple-touch-icon-180.png" width="90" height="90" class="ios" alt="">180 iOS</figure>
      <figure><img src="${k}/icon-192.png" width="64" height="64" alt="">192</figure>
      <figure><img src="${k}/favicon.svg" width="48" height="48" alt="">favicon 48</figure>
      <figure><img src="${k}/favicon-32.png" width="32" height="32" alt="">32</figure>
      <figure><img src="${k}/favicon-16.png" width="16" height="16" alt="">16</figure>
      <figure><img class="piksele" src="${k}/favicon-16.png" alt="">16 ×4</figure>
    </div>
  </div>
</div>
<div class="dol">
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
</div>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Znak dziennika: runda 3</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0e12;--surface:#12161c;--surface-2:#191f26;--line:#262e38;--line-strong:#35404d;--text:#e7ecf1;--muted:#97a3b0;--faint:#838f9d;--accent:#e8a44c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "IBM Plex Sans",sans-serif}
main{width:1440px;padding:48px 56px 64px}
h1{font-size:28px;line-height:36px;font-weight:600;margin:0 0 4px}
h2.sekcja{font-size:20px;line-height:28px;font-weight:600;margin:48px 0 16px}
.lead{color:var(--muted);margin:0 0 24px;max-width:980px}
.karta{background:var(--surface);border:1px solid rgb(255 255 255 / .12);border-radius:12px;padding:20px}
.etykieta{font:500 11px/16px "IBM Plex Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:0 0 12px}
.research{display:grid;grid-template-columns:640px 1fr;gap:24px;align-items:start}
.research img{width:640px;border-radius:12px;border:1px solid var(--line)}
.wnioski{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wnioski .karta{padding:14px 16px}.wnioski b{display:block;font-weight:600;margin-bottom:2px}.wnioski p{margin:0;color:var(--muted);font-size:13px}
.szkice{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
.szkic{margin:0;background:var(--surface);border:1px solid rgb(255 255 255 / .12);border-radius:12px;padding:14px}
.szkic.wybrany{border-color:rgb(232 164 76 / .6)}.szkic img{display:block;margin:0 auto 10px}
.szkic figcaption{font-size:12px;color:var(--muted);line-height:1.45}.szkic b{color:var(--text);font-weight:600;font-size:13.5px}
.werdykt{display:block;margin-top:6px;color:var(--faint);font-family:"IBM Plex Mono",monospace;font-size:10.5px;line-height:1.5}
.znacznik{font:500 10px "IBM Plex Mono",monospace;color:var(--bg);background:var(--accent);padding:1px 6px;border-radius:999px;vertical-align:1px}
.final{margin-bottom:56px;padding-top:8px;border-top:1px solid var(--line)}
.gora{display:grid;grid-template-columns:512px 1fr;gap:40px;margin:24px 0 20px}
.wielki{display:block}
.nazwa{font-size:24px;line-height:32px;font-weight:600;margin:0 0 8px}.opis{color:var(--muted);margin:0 0 16px;font-size:15px;max-width:640px}
.ocena{font-size:13.5px;color:var(--muted);margin:10px 0 0;max-width:680px}.ocena b{color:var(--text);font-weight:600}
.rozmiary{display:flex;gap:22px;align-items:flex-end}
.rozmiary figure{margin:0;text-align:center;font:11px "IBM Plex Mono",monospace;color:var(--faint)}.rozmiary img{display:block;margin:0 auto 6px}
.ios{border-radius:20px}.piksele{image-rendering:pixelated;width:64px;height:64px}
.dol{display:grid;grid-template-columns:300px 290px 1fr 220px;gap:20px;align-items:start}
.maski{display:flex;gap:12px}.maski img{width:52px;height:52px;display:block}
.kolo{border-radius:50%}.squircle{border-radius:22%}.kropla{border-radius:50% 50% 50% 12%}
.pasek{border-radius:8px;padding:8px 8px 0;margin-bottom:10px}.pasek.ciemny{background:#1f2329}.pasek.jasny{background:#dfe3e8}
.zakladki{display:flex;gap:2px}.zakladka{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:8px 8px 0 0;font-size:12px;width:132px;white-space:nowrap;overflow:hidden}
.ciemny .zakladka{color:#9aa3ad}.ciemny .zakladka.aktywna{background:#35393f;color:#e8eaed}.jasny .zakladka{color:#5f6368}.jasny .zakladka.aktywna{background:#fff;color:#202124}
.zakladka i{width:16px;height:16px;border-radius:3px;background:#6b7280;flex:none}.zakladka img{width:16px;height:16px;flex:none}
.telefon{border-radius:24px;padding:20px 12px;background:linear-gradient(160deg,#2a3644,#0f141a 75%);border:1px solid var(--line-strong);display:grid;grid-template-columns:repeat(4,1fr);row-gap:16px}
.apka{text-align:center;font-size:10px;color:#dfe5ea}.apka span,.apka img{display:block;width:50px;height:50px;margin:0 auto 5px;border-radius:13px}
.a1{background:#3b6fd8}.a2{background:#2f9e6a}.a3{background:#d1503e}.a4{background:#8a5cd0}.a5{background:#e1e5ea}.a6{background:#4b5563}.a7{background:#c9862e}
.app{display:grid;grid-template-columns:160px 1fr;height:262px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.sidebar{background:#080a0d;padding:16px 10px;border-right:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;padding:2px 8px 16px}.logo img{width:24px;height:24px}
.nav{font-size:13px;color:var(--muted);padding:6px 8px;border-radius:6px}.nav.aktywny{background:var(--surface-2);color:var(--text)}
.tresc{padding:16px 20px}.tresc h2{font-size:22px;line-height:28px;font-weight:600;margin:0 0 12px}
.pigulka{display:inline-block;font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid var(--line-strong);color:var(--muted);margin:0 6px 6px 0}
.pigulka.glowna{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:500}
.liczba{font:500 28px/36px "IBM Plex Mono",monospace;margin-top:16px}.roboczy{font:11px "IBM Plex Mono",monospace;color:var(--faint);margin-top:6px}
.logowanie{text-align:center}.logowanie img{display:block;margin:4px auto 8px}.lt{font-weight:600;font-size:16px;margin:0 0 12px}
.pole{height:30px;border:1px solid var(--line-strong);border-radius:6px;margin-bottom:8px;background:var(--bg)}
.przycisk{height:32px;border-radius:6px;background:var(--accent);color:var(--bg);font-weight:500;font-size:13px;line-height:32px}
.stopka{color:var(--muted);max-width:1200px;font-size:13px}.stopka b{color:var(--text);font-weight:500}
</style></head><body><main>
<h1>Znak dziennika: runda 3, więcej tradingu i detalu</h1>
<p class="lead">Po rundzie 2 (zbyt minimalistycznej): research znaków tradingowych, 12 szkiców z elementami tradingu, 3 finały w dwóch poziomach. Pełny znak z detalem ma od 180 do 512 px, a favicon z tej samej rodziny od 16 do 32 px. Tło #0b0e12, akcent #e8a44c; zieleń i czerwień tylko jako kolory świec. „Dziennik” to nazwa robocza (tekst roboczy).</p>
<h2 class="sekcja">Research</h2>
<div class="research"><img src="research/ikony-trading.png" alt="Ikony aplikacji tradingowych i fintech">
<div class="wnioski">${OCENY.wnioski.map((w) => `<div class="karta"><b>${w[0]}</b><p>${w[1]}</p></div>`).join("")}</div></div>
<h2 class="sekcja">12 szkiców</h2>
<div class="szkice">${sz}</div>
<h2 class="sekcja">3 finały</h2>
${fin}
<p class="stopka">${OCENY.stopka}</p>
</main></body></html>`;
}
