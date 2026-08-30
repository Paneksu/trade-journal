import { TradeForm } from "@/components/trades/trade-form";
import { requireSession } from "@/lib/auth/guard";
import { toLocalInput } from "@/lib/domain/calc";
import { fieldsForScope } from "@/lib/fields/fields";
import {
  getAccounts,
  getBacktestSessions,
  getFields,
  getInstruments,
  getProgi,
  getTagCategories,
  getTags,
} from "@/lib/queries/dictionaries";
import { lastUsed } from "@/lib/queries/trades";

export const metadata = { title: "Nowy trade — Dziennik tradingowy" };

export default async function NewTradePage({
  searchParams,
}: {
  searchParams: Promise<{ sesja?: string; dzien?: string; status?: string }>;
}) {
  const settings = await requireSession();
  const { sesja, dzien, status } = await searchParams;
  const sessionId = sesja ? Number(sesja) : null;
  const statusMissed = status === "missed";

  const [accounts, instruments, sessions, tags, categories, fields, last, progi] =
    await Promise.all([
      getAccounts(),
      getInstruments(),
      getBacktestSessions(),
      getTags(),
      getTagCategories(),
      getFields(),
      lastUsed(),
      getProgi(),
    ]);

  const active = accounts.filter((k) => !k.archived);
  const activeInstruments = instruments.filter((i) => i.active);

  /* "Teraz" liczone w strefie GIELDY instrumentu, ktory formularz pokaze jako
     pierwszy (ADR-022, 2026-08-30) - w tej samej strefie wpisuje sie godziny,
     wiec podpowiedz musi byc z tego samego zegara. Wczesniej byla ze strefy
     uzytkownika i przy kazdym nowym trade'zie trzeba bylo ja poprawiac. */
  const pierwszy =
    (activeInstruments.length > 0 ? activeInstruments : instruments).find(
      (i) => i.id === last.instrumentId,
    ) ?? (activeInstruments.length > 0 ? activeInstruments : instruments)[0];

  return (
    <div className="space-y-4">
      <header>
        <p className="etykieta">Dziennik</p>
        <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          {statusMissed
            ? "Trade, którego nie wziąłem"
            : sessionId
              ? "Nowy trade w sesji backtestu"
              : "Nowy trade"}
        </h1>
      </header>

      <TradeForm
        accounts={active.length > 0 ? active : accounts}
        instruments={activeInstruments.length > 0 ? activeInstruments : instruments}
        sessions={sessions.filter((s) => s.status === "running")}
        tags={tags}
        tagCategories={categories}
        fields={fieldsForScope(fields, sessionId !== null)}
        backtestSessionId={sessionId}
        progi={progi}
        values={{
          accountId: last.accountId,
          instrumentId: last.instrumentId,
          contracts: last.contracts ? String(Number(last.contracts)) : "1",
          /* Z karty dnia przychodzi konkretny dzien (`dzien`) bez godziny -
             domyslna godzina to otwarcie sesji regularnej instrumentu
             (rthFrom), NIE 00:00: naiwne `${dzien}T00:00` daje
             marketSession="overnight" (calc.ts), a przy godzinie >=18:00
             tradingDay przeskakuje na nastepny dzien (otwarcie CME). */
          entryTime: dzien
            ? `${dzien}T${pierwszy?.rthFrom ?? "09:30"}`
            : toLocalInput(new Date(), pierwszy?.exchangeTimezone ?? settings.timezone),
          status: statusMissed ? "missed" : undefined,
        }}
      />
    </div>
  );
}
