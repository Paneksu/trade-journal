import "dotenv/config";

import postgres from "postgres";

/*
 * Dane demonstracyjne przeglądu tygodnia (UI v2, etap 3): przegląd poprzedniego tygodnia zatwierdzony
 * (wnioski i jedno zobowiązanie słowami użytkownika) oraz szkic AI na ostatni pełny tydzień z migawką liczb,
 * żeby ekran /przeglad pokazał rozliczenie zobowiązania i ścieżkę zatwierdzenia.
 *
 * TYLKO baza lokalna. Uruchom po `scripts/demo-data.ts`:
 *   npx tsx scripts/demo-przeglad.ts
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
  console.error(`demo-przeglad odmawia: DATABASE_URL nie wskazuje na bazę lokalną (${host || "brak"}).`);
  process.exit(2);
}
const sql = postgres(url, { max: 1 });

const SZKIC = `**Tydzień w procesie.** Pięć zamkniętych trade'ów, cztery z oceną A albo B. Jedyny C to wejście przed zamrożeniem planu we wtorek.

- Najlepszy proces: FVG po sweepie w czwartek, plan zamrożony 6 minut przed wejściem.
- Najgorszy: wtorkowy pościg za świecą otwarcia, bez stopu w planie.
- Gra C kosztowała więcej niż wszystkie straty z dobrym procesem razem.

Propozycja na rozmowę: czy zobowiązanie z zeszłego tygodnia („tylko z zamrożonym planem”) wystarczy, skoro jedyne złamanie było właśnie przed planem?`;

async function main() {
  const tygodnie = await sql<{ w: string }[]>`
    select date_trunc('week', trading_day)::date::text w from trades
    where status = 'closed' and backtest_session_id is null and trading_day is not null
    group by 1 order by 1 desc limit 3`;
  if (tygodnie.length < 3) throw new Error("Za mało tygodni z trade'ami: najpierw scripts/demo-data.ts.");
  // Bieżący (niepełny) tydzień zostaje bez przeglądu; szkic na ostatni pełny, zatwierdzony tydzień przed nim.
  const szkicTydzien = tygodnie[1].w;
  const zatwierdzonyTydzien = tygodnie[2].w;
  const [juz] = await sql`select id from weekly_reviews where week_start in (${szkicTydzien}, ${zatwierdzonyTydzien})`;
  if (juz) {
    console.log("Przeglądy demo już są. Nic nie robię.");
    await sql.end();
    return;
  }
  await sql.begin(async (tx) => {
    await tx`select set_config('tj.actor', 'ui', true)`;
    const slowa = async (text: string, role: string, day: string) => {
      const [w] = await tx<{ id: number }[]>`insert into user_words (text, source, role, day, captured_at) values (${text}, 'ui', ${role}, ${day}, now()) returning id`;
      return w.id;
    };
    const wnioski = await slowa("Wchodziłem przed planem, kiedy rynek uciekał. Plan zamrożony = jedyne wejścia, które mi wychodzą.", "weekly.conclusions", zatwierdzonyTydzien);
    const zob = await slowa("W tym tygodniu wchodzę tylko z zamrożonym planem, bez wyjątków.", "weekly.commitment", zatwierdzonyTydzien);
    await tx`insert into weekly_reviews (week_start, status, conclusions_words_id, commitment_words_id, approved_at)
      values (${zatwierdzonyTydzien}, 'approved', ${wnioski}, ${zob}, now() - interval '9 days')`;
    await tx`select set_config('tj.actor', 'api:demo', true)`;
    await tx`insert into weekly_reviews (week_start, status, draft_md, stats_snapshot, as_of)
      values (${szkicTydzien}, 'draft', ${SZKIC}, ${tx.json({ zrodlo: "demo" })}, now() - interval '2 days')`;
  });
  console.log(`Przeglądy demo: zatwierdzony ${zatwierdzonyTydzien}, szkic AI ${szkicTydzien}.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
