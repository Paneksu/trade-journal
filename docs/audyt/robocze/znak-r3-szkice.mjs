// Runda 3 znaku dziennika: szkice z detalem tradingowym (siatka 512 x 512).
// Wspólne definicje i 12 szkiców. Używane przez generuj-znak-r3.mjs.
export const BG = "#0b0e12";
export const A = "#e8a44c";
export const ZYSK = "#46c08b"; // --color-profit, tylko jako kolor świecy
export const STRATA = "#e5654f"; // --color-loss, tylko jako kolor świecy
export const TEXT = "#e7ecf1";

// Definicje: tło kafla, złoto (pionowo), złoto metal (poziomo, faceta walca),
// stal (świece drugiego planu), poświata, siatka wykresu, cień.
export const defs = `<defs>
<radialGradient id="tlo" cx=".5" cy=".28" r=".85"><stop offset="0" stop-color="#1f2731"/><stop offset=".55" stop-color="#11161c"/><stop offset="1" stop-color="${BG}"/></radialGradient>
<linearGradient id="zloto" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd593"/><stop offset=".45" stop-color="${A}"/><stop offset="1" stop-color="#b3722a"/></linearGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b9792c"/><stop offset=".28" stop-color="#f6c47a"/><stop offset=".42" stop-color="#fde2ae"/><stop offset=".58" stop-color="${A}"/><stop offset="1" stop-color="#9a5f1f"/></linearGradient>
<linearGradient id="stal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a5562"/><stop offset=".35" stop-color="#8c99a7"/><stop offset=".5" stop-color="#a9b4bf"/><stop offset="1" stop-color="#3a434e"/></linearGradient>
<linearGradient id="zielen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2c8a61"/><stop offset=".4" stop-color="#6fd6a8"/><stop offset="1" stop-color="#1f6b4a"/></linearGradient>
<linearGradient id="czerwien" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a8402f"/><stop offset=".4" stop-color="#f08a78"/><stop offset="1" stop-color="#8c3324"/></linearGradient>
<linearGradient id="strona" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#222a34"/><stop offset="1" stop-color="#141920"/></linearGradient>
<radialGradient id="poswiata" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="${A}" stop-opacity=".22"/><stop offset="1" stop-color="${A}" stop-opacity="0"/></radialGradient>
<linearGradient id="krawedz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".3" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="siatka" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".045" stroke-width="2"/></pattern>
<filter id="cien" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".55"/></filter>
<filter id="blask" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>`;

// Świeca: x = środek, w = szerokość korpusu, knot od k1 do k2, korpus od b1 do b2.
export function swieca(x, w, k1, b1, b2, k2, fill = "url(#metal)", knot = "url(#zloto)") {
  const kw = Math.max(6, Math.round(w * 0.16));
  return `<rect x="${x - kw / 2}" y="${k1}" width="${kw}" height="${k2 - k1}" rx="${kw / 2}" fill="${knot}"/>
<rect x="${x - w / 2}" y="${b1}" width="${w}" height="${b2 - b1}" rx="${Math.round(w * 0.14)}" fill="${fill}"/>
<rect x="${x - w / 2 + 4}" y="${b1 + 3}" width="${w - 8}" height="3" rx="1.5" fill="#fff" fill-opacity=".35"/>`;
}

// Kafel ikony: tło, siatka wykresu (opcjonalnie), poświata, światło na krawędzi.
export function kafel(tresc, { siatka = true, pelne = false, skala = 1 } = {}) {
  const ks = pelne ? `width="512" height="512"` : `width="512" height="512" rx="112"`;
  const ramka = pelne ? "" : `<rect x="2" y="2" width="508" height="508" rx="110" fill="none" stroke="url(#krawedz)" stroke-width="4"/>`;
  const g = skala === 1 ? tresc : `<g transform="translate(256 256) scale(${skala}) translate(-256 -256)">${tresc}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
${defs}
<rect ${ks} fill="url(#tlo)"/>
${siatka ? `<rect ${ks} fill="url(#siatka)"/>` : ""}
<rect ${ks} fill="url(#poswiata)"/>
${ramka}
<g filter="url(#cien)">${g}</g>
</svg>
`;
}

// liście lauru wzdłuż łuku (strona -1 lewa, 1 prawa)
export function laur(strona, cx = 256, cy = 270, r = 172, n = 8) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const th = strona < 0 ? 112 + i * 16 : 68 - i * 16;
    const rad = (th * Math.PI) / 180;
    const x = cx + r * Math.cos(rad), y = cy + r * Math.sin(rad);
    const rot = th + (strona < 0 ? 25 : -25);
    const sc = 1 - i * 0.05;
    s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(11 * sc).toFixed(1)}" ry="${(25 * sc).toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#zloto)"/>`;
  }
  return s;
}

export const NQ = (x, y, h, t = 22) => {
  const w = h * 0.78;
  const qx = x + w + h * 0.62;
  return `<path fill="url(#zloto)" d="M${x} ${y}h${t}v${h}h-${t}ZM${x + w - t} ${y}h${t}v${h}h-${t}ZM${x} ${y}h${t * 1.25}L${x + w} ${y + h}h-${t * 1.25}Z"/>
<circle cx="${qx}" cy="${y + h / 2}" r="${h / 2 - t / 2}" fill="none" stroke="url(#zloto)" stroke-width="${t}"/>
<path d="M${qx + h * 0.08} ${y + h * 0.66}L${qx + h * 0.42} ${y + h * 1.02}" stroke="url(#zloto)" stroke-width="${t}"/>`;
};

export const SZKICE = {
  s01: {
    nazwa: "Trzy świece",
    idea: "Trzy rosnące świece z knotami z metalicznego złota na siatce wykresu.",
    tresc: () => swieca(150, 70, 236, 268, 380, 410) + swieca(256, 70, 168, 196, 330, 362) + swieca(362, 70, 100, 128, 270, 300),
  },
  s02: {
    nazwa: "FVG",
    idea: "Świeca przemieszczenia w złocie, po bokach stalowe, między nimi zaznaczona luka (FVG).",
    tresc: () =>
      `<rect x="96" y="232" width="320" height="64" fill="${A}" fill-opacity=".16"/>
<path d="M96 232H416M96 296H416" stroke="${A}" stroke-opacity=".75" stroke-width="3" stroke-dasharray="10 8"/>` +
      swieca(150, 64, 296, 318, 390, 420, "url(#stal)", "#8c99a7") +
      swieca(256, 76, 120, 146, 382, 404) +
      swieca(362, 64, 100, 124, 210, 232, "url(#stal)", "#8c99a7"),
  },
  s03: {
    nazwa: "Sweep",
    idea: "Przerywany poziom płynności nad szczytami, knot złotej świecy przebija go i wraca pod spód.",
    tresc: () =>
      `<path d="M92 196H420" stroke="${TEXT}" stroke-opacity=".55" stroke-width="4" stroke-dasharray="12 10"/>
<circle cx="340" cy="112" r="16" fill="${A}" filter="url(#blask)"/><circle cx="340" cy="112" r="8" fill="#fde2ae"/>` +
      swieca(132, 52, 196, 236, 330, 360, "url(#stal)", "#8c99a7") +
      swieca(220, 52, 196, 220, 300, 344, "url(#stal)", "#8c99a7") +
      swieca(340, 76, 112, 224, 380, 412),
  },
  s04: {
    nazwa: "Byk",
    idea: "Głowa byka w ścianach jak szlif kamienia, złoto z fasetami.",
    tresc: () =>
      `<path d="M196 214C142 206 108 170 100 108C130 150 168 170 214 178Z" fill="url(#metal)"/>
<path d="M316 214C370 206 404 170 412 108C382 150 344 170 298 178Z" fill="url(#metal)"/>
<path d="M176 224L134 250L188 262Z" fill="#b3722a"/><path d="M336 224L378 250L324 262Z" fill="#b3722a"/>
<path d="M176 204H336L320 300L292 392L256 420L220 392L192 300Z" fill="url(#zloto)"/>
<path d="M176 204L256 262L336 204M192 300L256 262L320 300M220 392L256 340L292 392M256 262V340M192 300L256 340L320 300" fill="none" stroke="#5a3a14" stroke-opacity=".45" stroke-width="3" stroke-linejoin="round"/>
<path d="M206 252L236 262L212 272Z" fill="${BG}"/><path d="M306 252L276 262L300 272Z" fill="${BG}"/>
<ellipse cx="238" cy="384" rx="7" ry="10" fill="#5a3a14"/><ellipse cx="274" cy="384" rx="7" ry="10" fill="#5a3a14"/>`,
  },
  s05: {
    nazwa: "Otwarty dziennik",
    idea: "Otwarta księga: na lewej stronie wpisy, na prawej trzy świece dnia.",
    tresc: () =>
      `<path d="M84 176Q170 150 256 182V418Q170 388 84 410Z" fill="url(#strona)" stroke="url(#zloto)" stroke-width="8" stroke-linejoin="round"/>
<path d="M428 176Q342 150 256 182V418Q342 388 428 410Z" fill="url(#strona)" stroke="url(#zloto)" stroke-width="8" stroke-linejoin="round"/>
<path d="M84 410Q170 392 256 426Q342 392 428 410" fill="none" stroke="#b3722a" stroke-width="6"/>
<path d="M112 222Q170 206 228 226M112 262Q170 246 228 266M112 302Q170 286 228 306M112 342Q160 328 200 342" fill="none" stroke="${A}" stroke-opacity=".55" stroke-width="6" stroke-linecap="round"/>` +
      swieca(300, 30, 272, 296, 356, 376, "url(#czerwien)", "#f08a78") +
      swieca(346, 30, 236, 256, 336, 352, "url(#metal)") +
      swieca(392, 30, 196, 214, 300, 322, "url(#zielen)", "#6fd6a8") +
      `<path d="M256 182V418" stroke="#b3722a" stroke-width="4"/>`,
  },
  s06: {
    nazwa: "Herb",
    idea: "Tarcza z podwójnym grawerem, w środku trzy rosnące świece, u góry NQ.",
    tresc: () =>
      `<path d="M256 84L412 132V258C412 352 344 408 256 438C168 408 100 352 100 258V132Z" fill="url(#strona)" stroke="url(#metal)" stroke-width="14" stroke-linejoin="round"/>
<path d="M256 110L388 150V258C388 338 330 386 256 412C182 386 124 338 124 258V150Z" fill="none" stroke="${A}" stroke-opacity=".5" stroke-width="3"/>
<path d="M140 196H372" stroke="${A}" stroke-opacity=".5" stroke-width="3"/>` +
      NQ(208, 132, 48, 12) +
      swieca(192, 40, 284, 306, 370, 390) + swieca(256, 40, 240, 262, 350, 372) + swieca(320, 40, 206, 226, 316, 336),
  },
  s07: {
    nazwa: "Pieczęć NQ",
    idea: "Okrągła pieczęć z ząbkowanym rantem jak moneta, w środku NQ i linia poziomu.",
    tresc: () => {
      let t = "";
      for (let i = 0; i < 72; i++) {
        const a = (i * 5 * Math.PI) / 180;
        t += `<path d="M${(256 + 160 * Math.cos(a)).toFixed(1)} ${(256 + 160 * Math.sin(a)).toFixed(1)}L${(256 + 172 * Math.cos(a)).toFixed(1)} ${(256 + 172 * Math.sin(a)).toFixed(1)}"/>`;
      }
      return `<circle cx="256" cy="256" r="184" fill="url(#strona)" stroke="url(#metal)" stroke-width="14"/>
<g stroke="${A}" stroke-opacity=".6" stroke-width="3">${t}</g>
<circle cx="256" cy="256" r="148" fill="none" stroke="${A}" stroke-opacity=".5" stroke-width="3"/>
<path d="M140 330H372" stroke="${A}" stroke-opacity=".55" stroke-width="3" stroke-dasharray="8 7"/>` + NQ(164, 196, 104, 24);
    },
  },
  s08: {
    nazwa: "Celownik",
    idea: "Celownik z pierścieniami i poziomami, złota świeca dokładnie w punkcie wejścia.",
    tresc: () =>
      `<circle cx="256" cy="256" r="168" fill="none" stroke="url(#metal)" stroke-width="10"/>
<circle cx="256" cy="256" r="118" fill="none" stroke="${A}" stroke-opacity=".45" stroke-width="3"/>
<path d="M256 72V150M256 362V440M72 256H150M362 256H440" stroke="url(#zloto)" stroke-width="8" stroke-linecap="round"/>
<path d="M120 206H392M120 306H392" stroke="${TEXT}" stroke-opacity=".4" stroke-width="3" stroke-dasharray="8 8"/>` +
      swieca(256, 54, 166, 200, 312, 346),
  },
  s09: {
    nazwa: "Świeca-dziennik",
    idea: "Jedna duża świeca, której korpus jest notesem: grzbiet z kółkami i linie wpisów.",
    tresc: () => {
      let k = "";
      for (let i = 0; i < 6; i++) {
        const y = 152 + i * 42;
        k += `<rect x="168" y="${y}" width="32" height="14" rx="7" fill="${BG}" fill-opacity=".55"/><rect x="164" y="${y + 2}" width="22" height="10" rx="5" fill="url(#stal)"/>`;
      }
      let l = "";
      for (let i = 0; i < 5; i++) l += `<path d="M214 ${176 + i * 44}H${i === 4 ? 290 : 322}" stroke="#7a4c18" stroke-opacity=".55" stroke-width="6" stroke-linecap="round"/>`;
      return `<rect x="247" y="70" width="18" height="76" rx="9" fill="url(#zloto)"/><rect x="247" y="390" width="18" height="56" rx="9" fill="url(#zloto)"/>
<rect x="176" y="132" width="160" height="268" rx="22" fill="url(#metal)"/>
<rect x="182" y="137" width="148" height="5" rx="2.5" fill="#fff" fill-opacity=".4"/>
${l}${k}
<path d="M300 330l14 14 26-30" fill="none" stroke="${ZYSK}" stroke-width="0" />`;
    },
  },
  s10: {
    nazwa: "Wybicie",
    idea: "Łamana ceny przebija przerywany poziom i kończy się grotem, pod nią złota poświata.",
    tresc: () =>
      `<path d="M96 380L176 300L226 336L300 222L340 254L410 140V420H96Z" fill="${A}" fill-opacity=".14"/>
<path d="M96 236H420" stroke="${TEXT}" stroke-opacity=".45" stroke-width="4" stroke-dasharray="12 10"/>
<path d="M96 380L176 300L226 336L300 222L340 254L404 152" fill="none" stroke="url(#zloto)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M366 140L420 124L410 180Z" fill="#fcd593" stroke="#fcd593" stroke-width="8" stroke-linejoin="round"/>`,
  },
  s11: {
    nazwa: "Kryształ",
    idea: "Świeca jako szlifowany kryształ: sześciokątny korpus z fasetami i knotami.",
    tresc: () =>
      `<rect x="248" y="58" width="16" height="70" rx="8" fill="url(#zloto)"/><rect x="248" y="384" width="16" height="70" rx="8" fill="url(#zloto)"/>
<path d="M256 96L332 156V356L256 416L180 356V156Z" fill="url(#zloto)"/>
<path d="M256 96L256 416L180 356V156Z" fill="#fde2ae" fill-opacity=".38"/>
<path d="M256 96L332 156L256 196L180 156Z" fill="#fff" fill-opacity=".22"/>
<path d="M256 416L332 356L256 316L180 356Z" fill="#5a3a14" fill-opacity=".35"/>
<path d="M256 196V316M180 156L256 196L332 156M180 356L256 316L332 356" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>`,
  },
  s12: {
    nazwa: "Odznaka z laurem",
    idea: "Odznaka: wieniec laurowy wokół trzech świec, pod spodem wstęga.",
    tresc: () =>
      laur(-1) + laur(1) +
      swieca(206, 44, 270, 294, 366, 388) + swieca(256, 44, 214, 236, 346, 370) + swieca(306, 44, 160, 180, 300, 324) +
      `<path d="M150 412H362L344 436L362 460H150L168 436Z" fill="url(#metal)"/>`,
  },
};
