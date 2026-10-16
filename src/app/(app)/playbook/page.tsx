import Link from "next/link";

import { Chip, NaglowekStrony, Pigulka, PustyStan } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { percent, rValue } from "@/lib/format";
import { playbook } from "@/lib/queries/playbook";

export const metadata = { title: "Playbook — Dziennik tradingowy" };

/*
 * Playbook: lista setupów (UI v2, etap 2, wzór 4: lista Linear w grupach ze statusem). Każda liczba z n
 * i przedziałem (MUST 5). Status setupu w kolorze tokenów: akcent tylko „obiecujący” (kierunek.md, wzór 4).
 */

const KOLEJNOSC = ["potwierdzony", "obiecujacy", "niejednoznaczny", "niewazny", "brak"] as const;
const NAZWY: Record<string, string> = { potwierdzony: "Potwierdzone", obiecujacy: "Obiecujące", niejednoznaczny: "Niejednoznaczne", niewazny: "Nieważne", brak: "Bez danych" };

export default async function PlaybookPage() {
  await requireSession();
  const karty = await playbook();
  const grupy = KOLEJNOSC.map((s) => [s, karty.filter((k) => (k.statystyka?.status ?? "brak") === s)] as const).filter(([, l]) => l.length > 0);

  return (
    <div className="mx-auto w-full max-w-tresc space-y-6">
      <NaglowekStrony
        tytul="Playbook"
        podtytul="Karty setupów: warunki, checklista, przykłady A+ i statystyka z przedziałem. Nowe wersje zatwierdzasz w „Do decyzji”."
        akcje={
          <>
            {/* Strategie (nazwa + checklista) zostają tylko dla sesji backtestu; karty setupów je zastępują w nawigacji. */}
            <Link href="/strategies" className="przejscie text-meta text-muted underline underline-offset-2 hover:text-text">
              Strategie sesji backtestu
            </Link>
            <Pigulka href="/decyzje">Do decyzji</Pigulka>
          </>
        }
      />
      {karty.length === 0 && <PustyStan tytul="Brak setupów." opis="Agent zakłada je przez łącznik, a Ty zatwierdzasz pierwszą wersję w „Do decyzji”." akcja={{ href: "/decyzje", etykieta: "Otwórz Do decyzji" }} />}
      {grupy.map(([status, lista]) => (
        <section key={status} aria-label={NAZWY[status]}>
          <h2 className="flex h-9 items-center gap-2 border-y border-line bg-panel px-3 text-meta text-text">
            {NAZWY[status]} <span className="num text-muted">{lista.length}</span>
          </h2>
          <ul>
            {lista.map((k) => {
              const s = k.statystyka;
              return (
                <li key={k.slug} className="border-b border-line">
                  <Link href={`/playbook/${k.slug}`} className="przejscie grid min-h-14 items-center gap-x-4 gap-y-1 px-3 py-2 hover:bg-panel sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <span className="min-w-0">
                      <span className="block text-karta text-text">{k.name}</span>
                      <span className="num block text-meta text-muted">
                        v{k.currentVersion ?? "—"} · {k.tradeow} trade&apos;ów · {k.przykladow} przykładów
                      </span>
                    </span>
                    <span className="num text-meta text-muted">
                      n = <span className="text-text">{s?.n ?? 0}</span>
                    </span>
                    <span className="num text-meta text-muted">
                      {s?.winRate.p == null ? "—" : percent(s.winRate.p, 0)}
                      {s?.winRate.low != null && s.winRate.high != null && <span> ({Math.round(s.winRate.low * 100)}–{Math.round(s.winRate.high * 100)})</span>}
                      <span> · {rValue(s?.expectancyR.mean ?? null)}</span>
                      {s?.expectancyR.orientacyjnie && <span> · orientacyjnie</span>}
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Chip className={cx("h-6", s?.status === "obiecujacy" && "border-accent/60 text-accent-strong")}>{s?.statusNazwa ?? "bez danych"}</Chip>
                      {k.pendingProposal && <Chip className="h-6">nowa wersja: {k.pendingProposal.signature}</Chip>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
