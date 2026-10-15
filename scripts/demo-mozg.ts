import "dotenv/config";
import { createHash } from "node:crypto";

import postgres from "postgres";

/*
 * Dane demonstracyjne Mózgu i Playbooka (UI v2, etap 2): notatki wszystkich rodzajów z linkami [[...]],
 * rewizje, słowa użytkownika z interpretacją AI, hipotezy z wariantami, propozycja reguły od AI
 * z kontrargumentem, sugestie AI, sprzeczność mentor kontra praktyka, luka strategii, słownik tradera,
 * korekta interpretacji, przykłady A+ i anty w setupie, cytaty mentora przy setupie.
 *
 * TYLKO baza lokalna. Uruchom po `scripts/demo-data.ts` i `scripts/demo-ui-v2.ts`:
 *   npx tsx scripts/demo-mozg.ts
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
  console.error(`demo-mozg odmawia: DATABASE_URL nie wskazuje na bazę lokalną (${host || "brak"}).`);
  process.exit(2);
}
const sql = postgres(url, { max: 1 });
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function main() {
  const [juz] = await sql`select id from notes where slug = 'fvg-fair-value-gap'`;
  if (juz) {
    console.log("Dane Mózgu już są. Nic nie robię.");
    await sql.end();
    return;
  }
  const [setup] = await sql<{ id: number; note_id: number }[]>`select id, note_id from setups where slug = 'fvg-po-sweepie'`;
  if (!setup) throw new Error("Najpierw scripts/demo-ui-v2.ts (brak setupu fvg-po-sweepie).");
  const tradeIds = (await sql<{ id: number }[]>`select id from trades where setup_id = ${setup.id} and status = 'closed' order by entry_time desc limit 6`).map((t) => t.id);
  const [tag] = await sql<{ id: number }[]>`select id from tags where archived = false order by id limit 1`;

  await sql.begin(async (tx) => {
    await tx`select set_config('tj.actor', 'ui', true)`;
    const nota = async (kind: string, slug: string, title: string, body: string, origin = "user", extra: Record<string, unknown> = {}) => {
      const [n] = await tx<{ id: number }[]>`insert into notes (kind, slug, title, body_md, origin, meta) values (${kind}, ${slug}, ${title}, ${body}, ${origin}, ${tx.json(extra as never)}) returning id`;
      await tx`insert into note_links (from_note_id, target) select ${n.id}, m[1] from regexp_matches(${body}, '\\[\\[([^\\]|#]+)', 'g') as m`;
      return n.id;
    };

    const fvg = await nota("concept", "fvg-fair-value-gap", "FVG (fair value gap)", `Luka między knotem świecy 1 a knotem świecy 3 przy silnym przemieszczeniu.\n\n## Jak go używam\n- tylko po [[Sweep płynności]] na tej samej stronie,\n- wejście na **CE** (50% luki) albo na krawędzi,\n- unieważnienie: zamknięcie świecy przez całą lukę.\n\n| Interwał | Rola |\n|---|---|\n| 1h | kontekst |\n| 5m | wejście |\n\nZobacz też [[Bias z 1h]] i [[System: rytuał dnia]].`);
    const sweep = await nota("concept", "sweep-plynnosci", "Sweep płynności", "Wybicie PDH/PDL o kilka ticków i powrót w zakres. Bez powrotu to nie sweep, tylko wybicie.\n\nPołączenie z [[FVG (fair value gap)]] daje setup [[FVG po sweepie]].");
    await nota("concept", "bias-z-1h", "Bias z 1h", "Bias ustalam przed otwarciem: struktura HH/HL albo LH/LL na 1h i zamknięcie świecy 9:00 NY.");
    await nota("system", "system-rytual-dnia", "System: rytuał dnia", "1. PDH, PDL, sesje.\n2. Bias z 1h.\n3. Unieważnienie zapisane słowami.\n4. Maks. 3 trade'y.\n\nZobacz [[Bias z 1h]].");
    await nota("system", "system-zasady-mozgu", "System: zasady mózgu", "AI jest audytorem z dowodami, nie doradcą. Każde twierdzenie ma dowód, poziom pewności i n.");
    await nota("mistake", "wzorzec-wejscie-przed-zamknieciem", "Wzorzec: wejście przed zamknięciem świecy", "Wchodzę, zanim świeca 5m domknie FVG. Koszt w ostatnich 20 trade'ach: −3,4R.", "ai");
    await nota("strength", "wzorzec-cierpliwosc-po-sweepie", "Wzorzec: cierpliwość po sweepie", "Gdy czekam na powrót w zakres, proces A w 8 z 10 trade'ów.");
    await nota("learning", "nauka-2026-10-14", "Dziennik nauki 14.10", "Sweep na 1m bez potwierdzenia na 5m daje gorsze wejścia (n = 7, orientacyjnie).", "ai");
    await nota("learning", "nauka-2026-10-15", "Dziennik nauki 15.10", "Trzymanie SL za knotem sweepu zamiast w luce: mniej wybić o 1–2 ticki.");
    await nota("brain_decision", "decyzja-limit-3", "Decyzja: limit 3 trade'ów", "Od 01.10 limit trzech trade'ów dziennie jest regułą twardą (R-003). Powód: trade'y 4+ mają ujemne R.");
    const strategia = await nota("strategy", "strategia-ict-nq", "Strategia: ICT na NQ", "Główna strategia. Setupy: [[FVG po sweepie]], iFVG na otwarciu.\n\nKontekst HTF zawsze z [[Bias z 1h]].");

    // Rewizje notatki pojęcia (trigger zapisuje poprzednią wersję).
    await tx`update notes set body_md = body_md || ${"\n\nDopisek: na NQ luka mniejsza niż 4 punkty to szum."}, updated_at = now() where id = ${fvg}`;

    // Słowa użytkownika przy notatce + interpretacja AI.
    const [w1] = await tx<{ id: number }[]>`insert into user_words (text, source, role, note_id, captured_at, ai_interpretation, interpretation_model, interpretation_at)
      values (${"Mój „czysty” FVG to taki, gdzie świeca 2 nie ma knota w drugą stronę.\nWtedy wchodzę na CE."}, 'chat', 'note.body', ${fvg}, now() - interval '2 days',
              ${"Użytkownik definiuje „czysty FVG” jako lukę, w której świeca przemieszczenia nie ma knota przeciwnego; wejście na CE (50%)."}, 'claude-opus', now() - interval '2 days') returning id`;
    const [w2] = await tx<{ id: number }[]>`insert into user_words (text, source, role, note_id, captured_at, ai_interpretation, interpretation_model, interpretation_at)
      values (${"Na 5m szukam luki tylko w kierunku biasu."}, 'chat', 'note.body', ${fvg}, now() - interval '1 day',
              ${"FVG przeciw biasowi z 1h są pomijane."}, 'claude-opus', now() - interval '1 day') returning id`;
    // Korekta interpretacji (rejestr poprawek) i słownik.
    const [kor] = await tx<{ id: number }[]>`insert into user_words (text, source, role, note_id, captured_at) values (${"Nie, chodziło mi o świecę 2, nie o świecę 3."}, 'chat', 'correction', ${fvg}, now() - interval '1 day') returning id`;
    const [term] = await tx<{ id: number }[]>`insert into profile_terms (term, meaning, concept_note_id, status, origin, decided_at) values ('czysty FVG', 'FVG@5m bez knota przeciwnego na świecy przemieszczenia', ${fvg}, 'confirmed', 'user', now()) returning id`;
    await tx`insert into profile_term_sources (term_id, words_id) values (${term.id}, ${w1.id})`;
    await tx`insert into profile_terms (term, meaning, status, origin) values ('odbicie od CE', 'reakcja ceny na 50% luki FVG', 'proposed', 'ai')`;
    await tx`insert into interpretation_corrections (words_id, before_interpretation, correction_words_id, after_interpretation, term_id, created_at)
      values (${w1.id}, 'Użytkownik definiuje „czysty FVG” jako lukę bez knota na świecy 3.', ${kor.id}, 'Użytkownik definiuje „czysty FVG” jako lukę, w której świeca przemieszczenia nie ma knota przeciwnego; wejście na CE (50%).', ${term.id}, now() - interval '1 day')`;
    void w2;

    // Hipotezy z wariantami.
    const hip = async (code: string, title: string, body: string, progN: number, imported: number) => {
      const nid = await nota("hypothesis", code.toLowerCase(), title, body);
      const [h] = await tx<{ id: number }[]>`insert into hypotheses (code, note_id, prog_n, n_imported, thresholds) values (${code}, ${nid}, ${progN}, ${imported}, ${tx.json({ minN: 20, potwierdzenieN: 100 } as never)}) returning id`;
      return h.id;
    };
    const h1 = await hip("H-001", "SL za knotem sweepu daje lepsze R niż SL w luce", "Porównanie dwóch wariantów stopu na setupie [[FVG po sweepie]].", 20, 13);
    const h2 = await hip("H-002", "Wejście po zamknięciu świecy 5m ma wyższą skuteczność", "Czekam na zamknięcie zamiast wchodzić w trakcie świecy.", 30, 31);
    await hip("H-003", "Okno 9:30–10:15 jest lepsze niż 10:15–11:00", "Podział okna sesji na dwie połowy.", 20, 6);
    for (const [label, n] of [["SL za knotem", 9], ["SL w połowie luki", 7], ["SL pod luką + 2 ticki", 4]] as const) {
      await tx`insert into hypothesis_variants (hypothesis_id, setup_id, label, params, params_hash, n_tested, origin) values (${h1}, null, ${label}, ${tx.json({ sl: label } as never)}, ${sha(label)}, ${n}, 'ai')`;
    }

    // Propozycja reguły od AI (kontrargument, dowody).
    const rnota = await nota("rule", "r-005", "Nie wchodzę w FVG po 10:30, gdy bias jest neutralny", "Propozycja reguły.", "ai");
    const [r5] = await tx<{ id: number }[]>`insert into rules (code, note_id, hard) values ('R-005', ${rnota}, false) returning id`;
    await tx`insert into rule_versions (rule_id, version, text_md, status, origin, counterargument, evidence, hypothesis_id)
      values (${r5.id}, 1, ${"Po **10:30 NY**, gdy bias z 1h jest neutralny, nie otwieram nowych pozycji na FVG."}, 'proposed', 'ai',
              ${"Próba jest mała (n = 23), a trzy najlepsze trade'y miesiąca padły właśnie po 10:30. Reguła może wyciąć rzadkie, ale duże ruchy."},
              ${tx.json([{ type: "trade", ref: tradeIds[0] ?? null, note: "−1R o 10:42, bias neutralny" }, { type: "trade", ref: tradeIds[1] ?? null, note: "−0,6R o 10:51" }, { type: "stat", note: "po 10:30 przy neutralnym biasie: 6/23 wygranych, Wilson 95%: 12–46%" }] as never)}, ${h2})`;

    // Sugestie AI do zatwierdzenia.
    if (tradeIds[2]) {
      await tx`insert into ai_suggestions (kind, status, target, payload, claim, evidence, evidence_level, n) values
        ('process_grade', 'pending', ${tx.json({ type: "trade", id: tradeIds[2] } as never)}, ${tx.json({ grade: "B" } as never)}, ${"Proces B: wejście 1 świecę za wcześnie, reszta zgodna z kartą setupu."}, ${tx.json([{ type: "trade", ref: tradeIds[2], note: "wejście 10:02, świeca zamknięta 10:05" }] as never)}, 'tested', 1)`;
    }
    if (tradeIds[3] && tag) {
      await tx`insert into ai_suggestions (kind, status, target, payload, claim, evidence, evidence_level, n) values
        ('tag', 'pending', ${tx.json({ type: "trade", id: tradeIds[3] } as never)}, ${tx.json({ tagId: tag.id, interval: "5m" } as never)}, ${"Tag sweep PDL na 5m: zebranie płynności widoczne na zrzucie 5m."}, ${tx.json([{ type: "screenshot", note: "zrzut 5m z 09:58" }] as never)}, 'partial', 12)`;
    }

    // Mentor: źródło, cytaty przy setupie, sprzeczność i luka.
    const [src] = await tx<{ id: number }[]>`insert into mentor_sources (video_id, title, url, status, transcript_source, processed_at, duration_s)
      values ('dQw4w9WgXcQ', 'ICT Mentorship: FVG i sweep', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'processed', 'captions', now(), 2710) returning id`;
    const [c1] = await tx<{ id: number }[]>`insert into mentor_claims (source_id, quote, quote_sha256, t_start_s, t_end_s, claim_type, paraphrase, status, setup_id, merged_note_id)
      values (${src.id}, ${"You want to see the sweep first, then the displacement that leaves the gap."}, ${sha("a")}, 754, 768, 'setup_condition', 'Najpierw sweep, potem przemieszczenie zostawiające lukę.', 'merged', ${setup.id}, ${setup.note_id}) returning id`;
    const [c2] = await tx<{ id: number }[]>`insert into mentor_claims (source_id, quote, quote_sha256, t_start_s, claim_type, paraphrase, status, setup_id)
      values (${src.id}, ${"Stops go below the low of the gap, not below the sweep."}, ${sha("b")}, 1213, 'management', 'SL pod dołem luki, nie pod sweepem.', 'extracted', ${setup.id}) returning id`;
    void c1;
    await tx`insert into strategy_gaps (kind, question, dedupe_key, setup_id, mentor_claim_id, note_id, status, origin)
      values ('mentor_conflict', 'Mentor stawia SL pod dołem luki, a Ty za knotem sweepu. Która wersja obowiązuje w setupie FVG po sweepie?', ${sha("konflikt-sl")}, ${setup.id}, ${c2.id}, ${fvg}, 'open', 'mentor')`;
    await tx`insert into strategy_gaps (kind, question, dedupe_key, setup_id, status, origin)
      values ('gap', 'Co robisz, gdy FVG jest w strefie discount, ale bias z 1h jest short?', ${sha("luka-discount")}, ${setup.id}, 'open', 'ai')`;
    await tx`insert into strategy_gaps (kind, question, dedupe_key, setup_id, status, origin, asked_at)
      values ('gap', 'Czy po trafionym TP1 przesuwasz SL na BE od razu, czy dopiero po kolejnej świecy?', ${sha("luka-be")}, ${setup.id}, 'asked', 'ai', now())`;

    // Karta setupu: opis, A+ i anty-przykłady ze zrzutów.
    await tx`update notes set body_md = ${"Setup z mojej praktyki: sweep PDL/PDH, przemieszczenie, FVG na 5m. Wejście na CE.\n\nPowiązane: [[FVG (fair value gap)]], [[Sweep płynności]]."}, updated_at = now() where id = ${setup.note_id}`;
    await tx`insert into note_links (from_note_id, target) values (${setup.note_id}, 'FVG (fair value gap)'), (${setup.note_id}, 'Sweep płynności')`;
    const zrzuty = await tx<{ id: number; trade_id: number }[]>`select distinct on (trade_id) id, trade_id from screenshots where trade_id = any(${tradeIds}) order by trade_id, sort_order, id`;
    for (const [i, z] of zrzuty.entries()) {
      await tx`insert into setup_examples (setup_id, trade_id, kind, screenshot_id, origin) values (${setup.id}, ${z.trade_id}, ${i % 3 === 2 ? "anti" : "a_plus"}, ${z.id}, 'user')`;
    }
    // Proponowana nowa wersja setupu od mentora (osobno: „wg mentora”).
    await tx`insert into setup_versions (setup_id, version, status, preconditions, entry_checklist, stop_rule, target_rule, be_rule, invalidation, thresholds, origin, evidence)
      values (${setup.id}, 3, 'proposed', ${tx.json([{ id: "p1", text: "sweep PDL albo PDH" }, { id: "p2", text: "przemieszczenie z luką" }] as never)}, ${tx.json([{ id: "c1", text: "FVG na 5m" }, { id: "c2", text: "świeca zamknięta" }] as never)}, 'pod dołem luki', 'PDH / PDL przeciwny', 'po +1R', 'zamknięcie przez lukę', ${tx.json({ minN: 20, potwierdzenieN: 100 } as never)}, 'mentor',
              ${tx.json({ videoId: "dQw4w9WgXcQ", tStartS: 1213, quote: "Stops go below the low of the gap, not below the sweep." } as never)})`;
    // Linki [[...]] dowiązane po tytule (jak przeliczLinki w API).
    await tx`update note_links l set to_note_id = n.id from notes n where lower(public.f_unaccent(n.title)) = lower(public.f_unaccent(l.target)) and l.to_note_id is null`;
    void strategia;
    void sweep;
  });
  console.log("Dane Mózgu i Playbooka: gotowe.");
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
