import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";

import { linkiNaMarkdown } from "@/components/mozg/linki";
import { ObrazZrzutu } from "@/components/screenshots/obraz-zrzutu";
import { Markdown } from "@/components/trade/markdown";
import { Chip, ChipProcesu } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { dateTime, percent, pnlClass, rValue, shortDate } from "@/lib/format";
import { tytulyNotatek } from "@/lib/queries/mozg";
import { kartaSetupu } from "@/lib/queries/playbook";

export const metadata = { title: "Setup — Playbook" };

/*
 * Karta setupu (UI v2, etap 2, wzór 4: profil Linear, Refero 4a094449). Lewa część: trade'y setupu w grupach
 * z paskiem nagłówka (A+, anty-przykłady, pozostałe), A+ i anty jako zrzuty użytkownika. Prawy panel ok. 420 px:
 * nazwa, status, wersja, zakładki Warunki / Statystyka / Historia (jak „Labels / Priority / Projects”).
 * „Wg mentora” osobno od Twoich słów i od propozycji AI. Status: akcent tylko „obiecujący”.
 */

const ZAKLADKI = [
  ["warunki", "Warunki"],
  ["statystyka", "Statystyka"],
  ["historia", "Historia"],
] as const;
const ZRODLA: Record<string, string> = { live: "live", demo: "demo", forward: "forward", backtest: "backtest" };
const STATUSY_WERSJI: Record<string, string> = { proposed: "propozycja", approved: "obowiązuje", rejected: "odrzucona", superseded: "zastąpiona" };

function teksty(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista.map((x) => (typeof x === "string" ? x : String((x as { text?: unknown }).text ?? ""))).filter(Boolean);
}

function czasZnacznika(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default async function KartaSetupuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { slug } = await params;
  const sp = await searchParams;
  const [k, tytuly] = await Promise.all([kartaSetupu(slug), tytulyNotatek()]);
  if (!k) notFound();
  const zakladka = ZAKLADKI.some(([z]) => z === sp.zakladka) ? (sp.zakladka as (typeof ZAKLADKI)[number][0]) : "warunki";
  const w = k.current;
  const glowna = k.stats.bySource.live ?? Object.values(k.stats.bySource).find((x) => x !== null) ?? null;
  const aPlus = k.przyklady.filter((p) => p.kind === "a_plus");
  const anty = k.przyklady.filter((p) => p.kind === "anti");
  const wPrzykladach = new Set(k.przyklady.map((p) => p.tradeId));
  const pozostale = k.tradey.filter((t) => !wPrzykladach.has(t.id));
  const tradePoId = new Map(k.tradey.map((t) => [t.id, t]));

  const Przyklady = ({ lista, tytul }: { lista: typeof k.przyklady; tytul: string }) => (
    <section aria-label={tytul}>
      <h2 className="flex h-9 items-center gap-2 border-y border-line bg-panel px-3 text-meta text-text">
        {tytul} <span className="num text-muted">{lista.length}</span>
      </h2>
      {lista.length === 0 ? (
        <p className="px-3 py-4 text-meta text-muted">Brak. Dodasz je z karty trade&apos;a albo przez sugestię AI.</p>
      ) : (
        <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((p) => {
            const t = tradePoId.get(p.tradeId);
            return (
              <li key={p.id}>
                <Link href={`/trades/${p.tradeId}`} className="przejscie block overflow-hidden rounded-[var(--radius-tab)] border border-line hover:border-line-strong">
                  {p.plik ? (
                    <ObrazZrzutu src={`/api/screenshots/${p.thumbnail ?? p.plik.file}`} alt={`Zrzut ${p.plik.interval ?? ""} trade'a #${p.tradeId}`} className="aspect-video w-full object-cover" />
                  ) : (
                    <span className="flex aspect-video items-center justify-center bg-surface-2 text-meta text-muted">bez zrzutu</span>
                  )}
                  <span className="flex items-center justify-between gap-2 px-2.5 py-2 text-meta">
                    <span className="num text-muted">{t ? `${t.dzien ? shortDate(t.dzien) : "—"} · ${t.symbol} ${t.kierunek}` : `#${p.tradeId}`}</span>
                    <span className={cx("num", t && !t.ukryty && pnlClass(t.r))}>{t?.ukryty ? "ukryty" : rValue(t?.r ?? null)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <nav aria-label="Okruszki" className="mb-4 flex items-center gap-1 text-meta text-muted">
        <Link href="/playbook" className="przejscie hover:text-text">
          Playbook
        </Link>
        <ChevronRight size={13} aria-hidden className="text-faint" />
        <span className="text-text">{k.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="order-2 min-w-0 space-y-6 lg:order-1">
          <Przyklady lista={aPlus} tytul="Przykłady A+" />
          <Przyklady lista={anty} tytul="Anty-przykłady" />
          <section aria-label="Pozostałe trade'y">
            <h2 className="flex h-9 items-center gap-2 border-y border-line bg-panel px-3 text-meta text-text">
              Pozostałe trade&apos;y <span className="num text-muted">{pozostale.length}</span>
            </h2>
            <ul>
              {pozostale.map((t) => (
                <li key={t.id} className="border-b border-line">
                  <Link href={`/trades/${t.id}`} className="przejscie flex min-h-11 items-center gap-3 px-3 hover:bg-panel">
                    <span className="num w-12 text-meta text-muted">{t.dzien ? shortDate(t.dzien) : "—"}</span>
                    <span className="min-w-0 flex-1 text-karta text-text">
                      <span className="num">{t.symbol}</span> <span className="text-muted">{t.kierunek}</span>
                    </span>
                    <ChipProcesu ocena={t.proces} />
                    <span className="num w-10 text-right text-meta text-muted">{t.wersjaNr ? `v${t.wersjaNr}` : "—"}</span>
                    <span className={cx("num w-20 text-right", !t.ukryty && pnlClass(t.r))}>{t.ukryty ? "ukryty" : rValue(t.r)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside aria-label="Karta setupu" className="karta order-1 h-fit overflow-hidden lg:sticky lg:top-20 lg:order-2">
          <div className="space-y-3 p-5">
            <h1 className="text-tytul font-medium tracking-tight text-text">{k.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Chip className={cx("h-6", glowna?.status === "obiecujacy" && "border-accent/60 text-accent-strong")}>{glowna?.statusNazwa ?? "bez danych"}</Chip>
              <span className="num text-meta text-muted">wersja {w?.version ?? "—"}</span>
              {k.proposal && (
                <Link href="/decyzje" className="przejscie text-meta text-muted underline underline-offset-2 hover:text-text">
                  nowa wersja czeka ({k.proposal.signature})
                </Link>
              )}
            </div>
            {glowna && (
              <p className="num text-meta text-muted">
                n = <span className="text-text">{glowna.n}</span> · skuteczność {percent(glowna.winRate.p, 0)}
                {glowna.winRate.low != null && glowna.winRate.high != null && ` (95%: ${Math.round(glowna.winRate.low * 100)}–${Math.round(glowna.winRate.high * 100)})`} · E {rValue(glowna.expectancyR.mean)}
                {glowna.expectancyR.orientacyjnie && " · orientacyjnie"}
              </p>
            )}
          </div>

          <nav aria-label="Zakładki karty" className="flex gap-1 border-y border-line bg-bg/30 p-1">
            {ZAKLADKI.map(([z, n]) => (
              <Link
                key={z}
                href={`/playbook/${k.slug}?zakladka=${z}`}
                scroll={false}
                aria-current={z === zakladka ? "page" : undefined}
                className={cx(
                  "przejscie flex h-8 flex-1 items-center justify-center rounded-[6px] text-meta",
                  z === zakladka ? "bg-accent-dim text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {n}
              </Link>
            ))}
          </nav>

          <div className="space-y-5 p-5">
            {zakladka === "warunki" && (
              <>
                {!w ? (
                  <p className="text-meta text-muted">Setup nie ma jeszcze zatwierdzonej wersji.</p>
                ) : (
                  <>
                    <div>
                      <p className="mb-2 text-meta text-muted">Warunki</p>
                      <ul className="space-y-1.5">
                        {teksty(w.preconditions).map((t) => (
                          <li key={t} className="flex gap-2 text-meta text-text">
                            <span aria-hidden className="text-muted">◦</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-2 text-meta text-muted">Checklista wejścia</p>
                      <ul className="space-y-1.5">
                        {teksty(w.entryChecklist).map((t) => (
                          <li key={t} className="flex gap-2 text-meta text-text">
                            <span aria-hidden className="text-muted">☐</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <dl className="border-t border-line pt-3">
                      {(
                        [
                          ["SL", w.stopRule],
                          ["TP", w.targetRule],
                          ["BE", w.beRule],
                          ["Unieważnienie", w.invalidation],
                          ["Czego unikać", w.avoid],
                        ] as const
                      ).map(([e, v]) => (
                        <div key={e} className="flex min-h-10 items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
                          <dt className="shrink-0 text-meta text-muted">{e}</dt>
                          <dd className="text-right text-meta text-text">{v ?? "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
                {k.bodyMd.trim() && (
                  <div className="border-t border-line pt-4">
                    <p className="mb-1.5 text-meta text-muted">Opis</p>
                    <Markdown className="text-meta">{linkiNaMarkdown(k.bodyMd, tytuly)}</Markdown>
                  </div>
                )}
              </>
            )}

            {zakladka === "statystyka" && (
              <>
                <ul className="border-t border-line">
                  {Object.entries(k.stats.bySource).map(([zr, s]) => (
                    <li key={zr} className="flex min-h-11 items-center justify-between gap-3 border-b border-line text-meta">
                      <span className="text-muted">{ZRODLA[zr] ?? zr}</span>
                      {s ? (
                        <span className="num text-right text-text">
                          n = {s.n} · {percent(s.winRate.p, 0)}
                          {s.winRate.low != null && s.winRate.high != null && <span className="text-muted"> ({Math.round(s.winRate.low * 100)}–{Math.round(s.winRate.high * 100)})</span>} · E {rValue(s.expectancyR.mean)}
                        </span>
                      ) : (
                        <span className="text-muted">brak danych</span>
                      )}
                    </li>
                  ))}
                </ul>
                {glowna && (
                  <p className="text-meta text-muted">
                    {glowna.opis} Break-even: {percent(glowna.breakEvenWinRate, 0)}. Progi: n ≥ {glowna.progi.minN}, potwierdzenie n ≥ {glowna.progi.potwierdzenieN}.
                  </p>
                )}
                {k.stats.backtestToLive && (
                  <p className="num text-meta text-text">
                    Backtest → live: {rValue(k.stats.backtestToLive.diffR)} na trade (n {k.stats.backtestToLive.backtestN} / {k.stats.backtestToLive.liveN})
                  </p>
                )}
                {k.unversionedTrades > 0 && <p className="text-meta text-muted">{k.unversionedTrades} trade&apos;ów bez wersji nie wchodzi do statystyki wersji.</p>}
              </>
            )}

            {zakladka === "historia" && (
              <ol className="space-y-3">
                {k.versions.map((v) => (
                  <li key={v.id} className={cx("border-l-2 pl-3", v.status === "approved" ? "border-accent" : "border-line-strong")}>
                    <p className="num text-meta text-text">
                      wersja {v.version} · {STATUSY_WERSJI[v.status] ?? v.status}
                    </p>
                    <p className="text-meta text-muted">
                      {v.signature} · {dateTime(v.proposedAt)}
                      {v.decisionReason && ` · ${v.decisionReason}`}
                    </p>
                  </li>
                ))}
              </ol>
            )}

            {/* „Wg mentora” osobno: cytat dosłownie z linkiem t=, nigdy wmieszany w Twoje warunki. */}
            {k.mentor.length > 0 && (
              <section aria-label="Wg mentora" className="space-y-3 border-t border-line pt-4">
                <p className="text-meta text-muted">wg mentora · n = 0</p>
                {k.mentor.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <blockquote className="border-l-2 border-line-strong pl-3 text-meta whitespace-pre-wrap text-text">{m.quote}</blockquote>
                    <a href={m.link} target="_blank" rel="noopener noreferrer" className="przejscie inline-flex items-center gap-1 text-grupa text-muted underline underline-offset-2 hover:text-text">
                      {m.tytul}, {czasZnacznika(m.tStartS)} <ExternalLink size={11} aria-hidden />
                    </a>
                  </div>
                ))}
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
