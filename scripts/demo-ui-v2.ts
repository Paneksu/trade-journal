import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import sharp from "sharp";

/*
 * Dane demonstracyjne ekranów UI v2 (faza 5): konta prop z regułami, zatwierdzone reguły, setup z
 * playbooka, oceny procesu, plan zamrożony z dopiskami, werdykt AI z dowodami, rytuał dnia, trade'y
 * dzisiejsze (w tym otwarty z werdyktem: wynik ukryty) i syntetyczne zrzuty wykresu.
 *
 * TYLKO baza lokalna. Uruchom po `npm run seed` i `npx tsx scripts/demo-data.ts`:
 *   npx tsx scripts/demo-ui-v2.ts
 * Wymaga DATABASE_URL na 127.0.0.1/localhost (bezpiecznik niżej, fail closed).
 */

const url = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`demo-ui-v2 odmawia: DATABASE_URL nie wskazuje na bazę lokalną (${host || "brak"}).`);
  process.exit(2);
}

const sql = postgres(url, { max: 1 });
const UPLOADS = path.resolve(process.env.UPLOADS_DIR ?? "./.dane/zrzuty");

function dzienNY(d = new Date()): string {
  // Dzień handlowy NQ: sesja zaczyna się o 18:00 ET (jak dzienHandlowyTeraz).
  const ny = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (ny.getHours() >= 18) ny.setDate(ny.getDate() + 1);
  return `${ny.getFullYear()}-${String(ny.getMonth() + 1).padStart(2, "0")}-${String(ny.getDate()).padStart(2, "0")}`;
}

/** Syntetyczny wykres świecowy (tylko dane demo): świece, strefa FVG, linie poziomów. */
function wykresSvg(ziarno: number, interwal: string): string {
  let s = ziarno;
  const los = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const W = 1600;
  const H = 900;
  const n = 64;
  let cena = 450 + los() * 60;
  const swiece: { o: number; c: number; h: number; l: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = cena;
    const trend = i > 30 && i < 38 ? -14 : i >= 38 ? 6 : 1.5;
    const c = o + (los() - 0.5) * 26 + trend;
    const h = Math.max(o, c) + los() * 12;
    const l = Math.min(o, c) - los() * 12;
    swiece.push({ o, c, h, l });
    cena = c;
  }
  const min = Math.min(...swiece.map((x) => x.l)) - 20;
  const max = Math.max(...swiece.map((x) => x.h)) + 20;
  const y = (v: number) => H - 60 - ((v - min) / (max - min)) * (H - 120);
  const dx = (W - 120) / n;
  const fvgG = swiece[36].l;
  const fvgD = swiece[38].h;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#131722"/>`;
  for (let i = 1; i < 8; i++) svg += `<line x1="0" x2="${W}" y1="${(i * H) / 8}" y2="${(i * H) / 8}" stroke="#1f2533"/>`;
  for (let i = 1; i < 12; i++) svg += `<line y1="0" y2="${H}" x1="${(i * W) / 12}" x2="${(i * W) / 12}" stroke="#1f2533"/>`;
  if (fvgD < fvgG) svg += `<rect x="${36 * dx + 20}" y="${y(fvgG)}" width="${W - 36 * dx - 140}" height="${y(fvgD) - y(fvgG)}" fill="#2962ff" fill-opacity=".18"/>`;
  swiece.forEach((k, i) => {
    const x = 20 + i * dx + dx / 2;
    const kolor = k.c >= k.o ? "#26a69a" : "#ef5350";
    svg += `<line x1="${x}" x2="${x}" y1="${y(k.h)}" y2="${y(k.l)}" stroke="${kolor}" stroke-width="2"/>`;
    svg += `<rect x="${x - dx * 0.32}" y="${y(Math.max(k.o, k.c))}" width="${dx * 0.64}" height="${Math.max(2, Math.abs(y(k.o) - y(k.c)))}" fill="${kolor}"/>`;
  });
  svg += `<line x1="0" x2="${W - 100}" y1="${y(swiece[20].h)}" y2="${y(swiece[20].h)}" stroke="#787b86" stroke-dasharray="8 6"/>`;
  svg += `<rect x="${W - 100}" y="0" width="100" height="${H}" fill="#131722"/><line x1="${W - 100}" x2="${W - 100}" y1="0" y2="${H}" stroke="#2a2e39"/>`;
  svg += `<text x="24" y="44" font-family="Arial" font-size="26" fill="#d1d4dc">NQ1! · ${interwal} · CME</text></svg>`;
  return svg;
}

async function zrzut(tradeId: number, ziarno: number, interwal: string, origin: string, kolejnosc: number, capturedAt: Date) {
  const dir = path.join(UPLOADS, String(tradeId));
  await mkdir(dir, { recursive: true });
  const nazwa = randomBytes(12).toString("hex");
  const png = await sharp(Buffer.from(wykresSvg(ziarno, interwal))).png().toBuffer();
  await sharp(png).webp({ quality: 85 }).toFile(path.join(dir, `${nazwa}.webp`));
  await sharp(png).resize({ width: 480 }).webp({ quality: 78 }).toFile(path.join(dir, `${nazwa}-mini.webp`));
  await sql`insert into screenshots (trade_id, file, thumbnail, width, height, sort_order, interval, origin, sha256, captured_at)
    values (${tradeId}, ${`${tradeId}/${nazwa}.webp`}, ${`${tradeId}/${nazwa}-mini.webp`}, 1600, 900, ${kolejnosc}, ${interwal}, ${origin},
            ${createHash("sha256").update(png).digest("hex")}, ${capturedAt})`;
}

async function naprawZrzuty() {
  // Testy na tej samej bazie potrafia skasowac katalogi zrzutow; odtwarzamy brakujace pliki pod ta sama sciezka.
  const { existsSync } = await import("node:fs");
  const wiersze = await sql<{ id: number; file: string; thumbnail: string | null; interval: string | null }[]>`select id, file, thumbnail, interval from screenshots where trade_id is not null`;
  let ile = 0;
  for (const w of wiersze) {
    if (existsSync(path.join(UPLOADS, w.file))) continue;
    await mkdir(path.dirname(path.join(UPLOADS, w.file)), { recursive: true });
    const png = await sharp(Buffer.from(wykresSvg(w.id * 7, w.interval ?? "5m"))).png().toBuffer();
    await sharp(png).webp({ quality: 85 }).toFile(path.join(UPLOADS, w.file));
    if (w.thumbnail) await sharp(png).resize({ width: 480 }).webp({ quality: 78 }).toFile(path.join(UPLOADS, w.thumbnail));
    ile += 1;
  }
  console.log(`Odtworzone pliki zrzutow: ${ile}.`);
  await sql.end();
}

async function main() {
  if (process.argv.includes("--napraw-zrzuty")) return naprawZrzuty();
  const dzis = dzienNY();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from trades`;
  if (n === 0) throw new Error("Najpierw `npx tsx scripts/demo-data.ts` (brak trade'ów).");
  const [juz] = await sql`select id from accounts where name = 'Apex 50K PA'`;
  if (juz) {
    console.log("Dane UI v2 już są (konto Apex 50K PA istnieje). Nic nie robię.");
    await sql.end();
    return;
  }

  const [nq] = await sql<{ id: number }[]>`select id from instruments where symbol = 'NQ'`;
  const [mnq] = await sql<{ id: number }[]>`select id from instruments where symbol = 'MNQ'`;

  await sql.begin(async (tx) => {
    await tx`select set_config('tj.actor', 'ui', true)`;

    // --- Konta prop i reguły (jedna potwierdzona, jedna niepotwierdzona) ---
    const [apex] = await tx<{ id: number }[]>`insert into accounts (name, currency, starting_balance, type, prop_phase, default_risk_amount, sort_order)
      values ('Apex 50K PA', 'USD', 5000000, 'prop', 'funded', 25000, 10) returning id`;
    const [topstep] = await tx<{ id: number }[]>`insert into accounts (name, currency, starting_balance, type, prop_phase, default_risk_amount, sort_order)
      values ('Topstep 50K Combine', 'USD', 5000000, 'prop', 'eval', 20000, 11) returning id`;
    await tx`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents, dd_lock_cents, daily_loss_cents, profit_target_cents, consistency_pct, min_days, max_contracts_mini, max_contracts_micro, source_url, confirmed_at)
      values (${apex.id}, '2026-01-01', 'trailing_to_static', 250000, 5010000, null, null, 30, 7, 10, 100, 'https://apextraderfunding.com', now())`;
    await tx`insert into prop_rules (account_id, valid_from, dd_type, max_dd_cents, daily_loss_cents, profit_target_cents, consistency_pct, min_days, max_contracts_mini, max_contracts_micro, source_url)
      values (${topstep.id}, '2026-01-01', 'eod', 200000, 100000, 300000, 50, 2, 5, 50, 'https://www.topstep.com')`;

    // Historia kont: przenosimy część trade'ów z ostatnich 20 dni na konta prop.
    await tx`update trades set account_id = ${apex.id} where id in (select id from trades where trading_day >= ${dzis}::date - 20 and backtest_session_id is null order by id limit 9)`;
    await tx`update trades set account_id = ${topstep.id} where id in (select id from trades where trading_day >= ${dzis}::date - 20 and backtest_session_id is null and account_id <> ${apex.id} order by id limit 6)`;

    // --- Reguły zatwierdzone ---
    const reguly: [string, string, boolean, string][] = [
      ["R-001", "Najpierw bias z 1h, potem wejście na 5m", true, "Wchodzę tylko zgodnie z biasem ustalonym na 1h przed otwarciem."],
      ["R-002", "Wejście tylko w oknie 9:30–11:00 NY", true, "Po 11:00 NY nie otwieram nowych pozycji."],
      ["R-003", "Maksymalnie trzy trade'y dziennie", true, "Czwarty trade dnia to naruszenie twardej reguły."],
      ["R-004", "SL za knotem sweepu, nie w środku FVG", false, "Stop stoi za knotem świecy, która zebrała płynność."],
    ];
    for (const [code, tytul, twarda, tekst] of reguly) {
      const [nota] = await tx<{ id: number }[]>`insert into notes (kind, slug, title, body_md) values ('rule', ${code.toLowerCase()}, ${tytul}, ${tekst}) returning id`;
      const [r] = await tx<{ id: number }[]>`insert into rules (code, note_id, hard) values (${code}, ${nota.id}, ${twarda}) returning id`;
      await tx`insert into rule_versions (rule_id, version, text_md, status, origin, decided_at, ruleset_version) values (${r.id}, 1, ${tekst}, 'approved', 'user', now(), 1)`;
    }
    await tx`update settings set ruleset_version = greatest(ruleset_version, 1) where id = 1`;

    // --- Setup z playbooka ---
    const [notaSetupu] = await tx<{ id: number }[]>`insert into notes (kind, slug, title, body_md) values ('setup', 'fvg-po-sweepie', 'FVG po sweepie', 'Karta setupu.') returning id`;
    const [setup] = await tx<{ id: number }[]>`insert into setups (slug, name, note_id) values ('fvg-po-sweepie', 'FVG po sweepie', ${notaSetupu.id}) returning id`;
    const [wersja] = await tx<{ id: number }[]>`insert into setup_versions (setup_id, version, status, preconditions, entry_checklist, stop_rule, thresholds, origin, decided_at)
      values (${setup.id}, 2, 'approved', '["sweep PDL albo PDH"]', '["FVG na 5m po sweepie", "świeca zamknięta"]', 'za knotem sweepu', '{}', 'user', now()) returning id`;
    const [notaSetupu2] = await tx<{ id: number }[]>`insert into notes (kind, slug, title, body_md) values ('setup', 'ifvg-otwarcie', 'iFVG na otwarciu', 'Karta setupu.') returning id`;
    const [setup2] = await tx<{ id: number }[]>`insert into setups (slug, name, note_id) values ('ifvg-otwarcie', 'iFVG na otwarciu', ${notaSetupu2.id}) returning id`;

    // Oceny procesu i setup na trade'ach z ostatnich 60 dni.
    const ostatnie = await tx<{ id: number }[]>`select id from trades where trading_day >= ${dzis}::date - 60 and backtest_session_id is null order by id`;
    const oceny = ["A", "B", "A", "C", "B", "A", "B"];
    for (const [i, t] of ostatnie.entries()) {
      await tx`update trades set process_grade = ${oceny[i % oceny.length]}, process_graded_at = now(),
        setup_id = ${i % 3 === 2 ? setup2.id : setup.id}, setup_version_id = ${i % 3 === 2 ? null : wersja.id} where id = ${t.id}`;
    }

    // --- Trade'y dzisiejsze: kopia struktury istniejącego trade'a z nowym czasem ---
    const wzor = await tx<{ id: number }[]>`select id from trades where status = 'closed' and direction = 'long' and r_multiple > 0 and instrument_id = ${nq.id} order by id limit 1`;
    const wzorId = wzor[0]?.id ?? (await tx<{ id: number }[]>`select id from trades where status = 'closed' order by id limit 1`)[0].id;
    const kolumny = (await tx<{ c: string }[]>`select column_name as c from information_schema.columns where table_name = 'trades' and column_name not in ('id', 'search', 'entry_time', 'exit_time', 'trading_day', 'created_at', 'updated_at', 'status', 'process_grade', 'process_graded_at', 'setup_id', 'setup_version_id', 'account_id', 'note', 'external_ref', 'source', 'is_generated') and is_generated = 'NEVER' order by ordinal_position`).map((r) => r.c);
    const lista = tx.unsafe(kolumny.map((c) => `"${c}"`).join(", "));
    const wejscie1 = new Date(`${dzis}T13:42:00Z`);
    const [t1] = await tx<{ id: number }[]>`insert into trades (${lista}, entry_time, exit_time, trading_day, status, account_id, note, source, process_grade, process_graded_at, setup_id, setup_version_id)
      select ${lista}, ${wejscie1}, ${new Date(wejscie1.getTime() + 21 * 60_000)}, ${dzis}, 'closed', ${apex.id},
        ${"Wszedłem po sweepie PDL, FVG na 5m domknięte. Wyszedłem na TP1, resztę na BE."}, 'form', 'A', now(), ${setup.id}, ${wersja.id}
      from trades where id = ${wzorId} returning id`;
    const wejscie2 = new Date(`${dzis}T14:55:00Z`);
    const [t2] = await tx<{ id: number }[]>`insert into trades (${lista}, entry_time, exit_time, trading_day, status, account_id, note, source, setup_id, setup_version_id)
      select ${lista}, ${wejscie2}, null, ${dzis}, 'open', ${topstep.id}, null, 'fxreplay', ${setup.id}, ${wersja.id}
      from trades where id = ${wzorId} returning id`;
    await tx`update trades set exit_price = null, pnl = 0, r_multiple = null where id = ${t2.id}`;
    await tx`delete from trade_exits where trade_id in (${t1.id}, ${t2.id})`;
    await tx`insert into trade_exits (trade_id, sort_order, exit_time, exit_price, contracts) select ${t1.id}, 0, ${new Date(wejscie1.getTime() + 21 * 60_000)}, exit_price, contracts from trades where id = ${t1.id}`;

    // --- Plan zamrożony, słowa użytkownika, dopiski (trade t1) ---
    const slowa = async (text: string, role: string, extra: { tradeId?: number; day?: string; at: Date; source?: string; ai?: string }) => {
      const [w] = await tx<{ id: number }[]>`insert into user_words (text, source, role, trade_id, day, captured_at, ai_interpretation, interpretation_model, interpretation_at)
        values (${text}, ${extra.source ?? "chat"}, ${role}, ${extra.tradeId ?? null}, ${extra.day ?? null}, ${extra.at}, ${extra.ai ?? null}, ${extra.ai ? "claude-opus" : null}, ${extra.ai ? new Date() : null}) returning id`;
      return w.id;
    };
    const przed = new Date(wejscie1.getTime() - 6 * 60_000);
    const teza = await slowa("Sweep PDL o 9:35, 5m FVG nad nim. Long do PDH, SL pod knotem sweepu.", "plan.thesis", { day: dzis, at: przed });
    const uniew = await slowa("Zamknięcie 5m pod 20 104 unieważnia setup.", "plan.invalidation", { day: dzis, at: przed });
    const [tradeT1] = await tx<{ entry_price: string; stop_loss: string | null; take_profit: string | null; contracts: string; risk_amount: number | null }[]>`select entry_price, stop_loss, take_profit, contracts, risk_amount from trades where id = ${t1.id}`;
    const ep = Number(tradeT1.entry_price);
    const sl = Number(tradeT1.stop_loss ?? ep - 20);
    const tp = Number(tradeT1.take_profit ?? ep + 40);
    const [plan] = await tx<{ id: number }[]>`insert into trade_plans (trade_id, account_id, instrument_id, day, setup_id, setup_version_id, ruleset_version, direction, bias, entry_price, stop_loss, take_profit, contracts, risk_cents, thesis_words_id, invalidation_words_id, origin, frozen_at, entry_time_at_attach)
      values (${t1.id}, ${apex.id}, ${nq.id}, ${dzis}, ${setup.id}, ${wersja.id}, 1, 'long', 'long', ${ep}, ${sl}, ${tp}, ${tradeT1.contracts}, ${tradeT1.risk_amount ?? 25000}, ${teza}, ${uniew}, 'user', ${przed}, ${wejscie1}) returning id`;
    const dopisek1 = await slowa("Przesuwam SL na BE po +1R.", "plan.addendum", { day: dzis, at: new Date(wejscie1.getTime() + 9 * 60_000) });
    await tx`insert into trade_plan_addenda (plan_id, field, new_value, words_id, created_at) values (${plan.id}, 'stop_loss', ${String(ep)}, ${dopisek1}, ${new Date(wejscie1.getTime() + 9 * 60_000)})`;
    const dopisek2 = await slowa("TP1 zebrane na połowie pozycji, reszta jedzie do PDH.", "plan.addendum", { day: dzis, at: new Date(wejscie1.getTime() + 14 * 60_000) });
    await tx`insert into trade_plan_addenda (plan_id, field, new_value, words_id, created_at) values (${plan.id}, 'take_profit', null, ${dopisek2}, ${new Date(wejscie1.getTime() + 14 * 60_000)})`;
    await slowa("Wszedłem za wcześnie o jedną świecę, ale plan trzymany. Nie ruszałem SL poza dopiskiem.", "trade.note", {
      tradeId: t1.id,
      day: dzis,
      at: new Date(wejscie1.getTime() + 30 * 60_000),
      ai: "Użytkownik ocenia wejście jako przedwczesne o jedną świecę 5m, a zarządzanie jako zgodne z planem (BE po +1R zapisane dopiskiem).",
    });

    // --- Werdykt AI przed wynikiem (t1) i na otwartym t2 (wynik ukryty) ---
    const werdykt = async (tradeId: number, asOf: Date, podsumowanie: string, sprawdzenia: [string, string, string, string][]) => {
      const [r] = await tx<{ id: number }[]>`insert into trade_reviews (trade_id, setup_type, summary_md, basis, brain_verdict, brain_version, evidence_cutoff, model, kind, as_of, evidence_hash, ruleset_version)
        values (${tradeId}, 'FVG po sweepie', ${podsumowanie}, 'chart', 'wejdz', 'abcdef12', ${asOf}, 'claude-opus-4', 'ai', ${asOf},
                ${createHash("sha256").update(podsumowanie).digest("hex")}, 1) returning id`;
      for (const [kod, tekst, wynik, dowod] of sprawdzenia) {
        await tx`insert into trade_rule_checks (review_id, rule_id, rule_text, verdict, evidence) values (${r.id}, ${kod}, ${tekst}, ${wynik}, ${dowod})`;
      }
    };
    await werdykt(t1.id, new Date(wejscie1.getTime() - 60_000), "Setup zgodny z kartą **FVG po sweepie** w wersji 2. Sweep PDL potwierdzony na 1m i 5m, FVG domknięte świecą 9:40.\n\n- bias z 1h: long (HH, HL od wczoraj)\n- wejście w oknie 9:30–11:00", [
      ["R-001", "Najpierw bias z 1h, potem wejście na 5m", "pass", "1h: HH 20 188, HL 20 096 przed otwarciem; świeca 9:00 zamknięta nad 20 150."],
      ["R-002", "Wejście tylko w oknie 9:30–11:00 NY", "pass", "Wejście 9:42 NY."],
      ["R-004", "SL za knotem sweepu, nie w środku FVG", "fail", "SL 20 108, knot sweepu 20 101: stop 7 punktów nad knotem, wewnątrz luki."],
    ]);
    await werdykt(t2.id, new Date(wejscie2.getTime() - 60_000), "Setup częściowo zgodny: FVG jest, ale sweep tylko na 1m.", [
      ["R-001", "Najpierw bias z 1h, potem wejście na 5m", "pass", "1h long od otwarcia."],
      ["R-002", "Wejście tylko w oknie 9:30–11:00 NY", "pass", "Wejście 10:55 NY."],
    ]);

    // --- Rytuał dnia (notatka dnia bez konta) i unieważnienie ---
    await tx`insert into day_notes (day, account_id, pre_session, bias, max_trades, sleep, energy)
      values (${dzis}, null, ${"PDL 20 096 i PDH 20 240. Czekam na sweep jednej strony w pierwszej godzinie."}, 'long', 3, 4, 3)
      on conflict do nothing`;
    await slowa("Zamknięcie 1h pod 20 080 kończy long na dziś.", "day.invalidation", { day: dzis, at: new Date(`${dzis}T12:50:00Z`), source: "ui" });

    await tx`select 1`;
    console.log(`Konta: Apex #${apex.id}, Topstep #${topstep.id}; dziś ${dzis}: trade #${t1.id} (zamknięty, plan, werdykt), #${t2.id} (otwarty z werdyktem).`);
    (globalThis as { __t?: number[] }).__t = [t1.id, t2.id, mnq?.id ?? 0];
  });

  // Zrzuty (poza transakcją: pliki). Dzisiejszy zamknięty + 24 ostatnie trade'y do galerii i szuflady.
  const [t1, t2] = (globalThis as { __t?: number[] }).__t ?? [];
  const dzisZrzut = new Date(`${dzis}T13:41:00Z`);
  await zrzut(t1, 11, "1h", "tradingview", 0, dzisZrzut);
  await zrzut(t1, 12, "5m", "tradingview", 1, dzisZrzut);
  await zrzut(t1, 13, "1m", "fxreplay", 2, new Date(dzisZrzut.getTime() + 25 * 60_000));
  await zrzut(t2, 14, "5m", "fxreplay", 0, new Date(`${dzis}T14:54:00Z`));
  const reszta = await sql<{ id: number; entry_time: Date }[]>`select id, entry_time from trades where id not in (${t1}, ${t2}) and backtest_session_id is null order by entry_time desc limit 24`;
  for (const [i, t] of reszta.entries()) {
    await zrzut(t.id, 100 + i, i % 2 ? "5m" : "1m", i % 3 ? "tradingview" : "manual", 0, new Date(t.entry_time.getTime() - 60_000));
  }
  console.log(`Zrzuty: ${3 + 1 + reszta.length}.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
