import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Pencil } from "lucide-react";

import { EdytorNotatki } from "@/components/mozg/edytor";
import { linkiNaMarkdown } from "@/components/mozg/linki";
import { SlowaUzytkownikaNotatki } from "@/components/mozg/slowa";
import { ObrazZrzutu } from "@/components/screenshots/obraz-zrzutu";
import { zrodlaZrzutu } from "@/components/screenshots/zrodla";
import { Markdown } from "@/components/trade/markdown";
import { Chip, klasaPigulki } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { dateTime } from "@/lib/format";
import { NAZWY_KINDOW, notatkaDoWidoku, tytulyNotatek } from "@/lib/queries/mozg";

export const metadata = { title: "Notatka — Mózg" };

/*
 * Notatka z backlinkami (UI v2, wzór 9: Memotron, Refero e516f4e0). Notatka ok. 65% w kolumnie lektury
 * (68 znaków), prawy panel ok. 35% „Linki”: backlinki, linki wychodzące, załączniki, rewizje. Przełącznik
 * Podgląd / Edycja na dole (wzór: Markdown / Bird view). Markdown bez surowego HTML; „Słowa użytkownika”
 * dosłownie i „interpretacja AI” osobno (MUST 13).
 */

const ZARZADZANE = new Set(["rule", "hypothesis", "setup"]);
const STATUSY_WERSJI: Record<string, string> = { proposed: "propozycja", approved: "obowiązuje", rejected: "odrzucona", superseded: "zastąpiona" };
const POCHODZENIE: Record<string, string> = { user: "Ty", ai: "AI", mentor: "mentor", "vault-import": "import z sejfu" };

export default async function NotatkaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const noteId = Number(id);
  if (!Number.isInteger(noteId) || noteId < 1) notFound();
  const [n, tytuly] = await Promise.all([notatkaDoWidoku(noteId), tytulyNotatek()]);
  if (!n) notFound();
  const zarzadzana = ZARZADZANE.has(n.kind);
  const edycja = sp.tryb === "edycja" && !zarzadzana;
  const sciezka = `/mozg/notatki/${n.id}`;

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <div className="min-w-0 space-y-6">
          <nav aria-label="Okruszki" className="flex flex-wrap items-center gap-1 text-meta text-muted">
            <Link href="/mozg" className="przejscie hover:text-text">
              Mózg
            </Link>
            <ChevronRight size={13} aria-hidden className="text-faint" />
            <span>{NAZWY_KINDOW[n.kind] ?? n.kind}</span>
          </nav>

          {edycja ? (
            <EdytorNotatki notatka={{ id: n.id, rev: n.rev, title: n.title, bodyMd: n.bodyMd }} tytuly={tytuly} anuluj={sciezka} />
          ) : (
            <>
              <header className="space-y-3">
                <h1 className="text-tytul font-medium tracking-tight text-text">{n.title}</h1>
                <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
                  <Chip className="h-6">{NAZWY_KINDOW[n.kind] ?? n.kind}</Chip>
                  <span>autor: {POCHODZENIE[n.origin] ?? n.origin}</span>
                  <span className="num">· rewizja {n.rev}</span>
                  <span className="num">· {dateTime(n.updatedAt)}</span>
                  {n.regula && (
                    <span className="num">
                      · {n.regula.code} {n.regula.hard ? "· twarda" : ""} · {n.regula.status}
                    </span>
                  )}
                </div>
              </header>

              {n.regula ? (
                <section aria-label="Wersje reguły" className="space-y-4">
                  {n.regula.wersje.map((w) => (
                    <article key={w.version} className={cx("max-w-[68ch] border-l-2 pl-4", w.status === "approved" ? "border-accent" : "border-line-strong")}>
                      <p className="num mb-1.5 text-meta text-muted">
                        wersja {w.version} · {STATUSY_WERSJI[w.status] ?? w.status} · {POCHODZENIE[w.origin] ?? w.origin}
                        {w.origin === "ai" && " · propozycja AI"}
                      </p>
                      <Markdown>{w.textMd}</Markdown>
                    </article>
                  ))}
                  <p className="text-meta text-muted">
                    Treść reguły zmienia tylko nowa wersja zatwierdzona w{" "}
                    <Link href="/decyzje" className="przejscie text-text underline underline-offset-2 hover:text-accent">
                      Do decyzji
                    </Link>
                    .
                  </p>
                </section>
              ) : (
                <div className="max-w-[68ch]">{n.bodyMd.trim() ? <Markdown className="text-[1rem] leading-[1.7]">{linkiNaMarkdown(n.bodyMd, tytuly)}</Markdown> : <p className="text-meta text-muted">Notatka jest pusta.</p>}</div>
              )}

              {n.dopiski.length > 0 && (
                <section aria-label="Dopiski" className="max-w-[68ch] space-y-3">
                  <h2 className="text-karta text-text">Dopiski</h2>
                  {n.dopiski.map((d) => (
                    <div key={d.id} className="rounded-[var(--radius-tab)] border border-dashed border-line-strong px-4 py-3">
                      <p className="num mb-1 text-meta text-muted">
                        {d.origin === "ai" ? "dopisek AI" : d.origin === "mentor" ? "wg mentora" : "dopisek"} · {dateTime(d.createdAt)}
                        {d.tradeId && (
                          <>
                            {" · "}
                            <Link href={`/trades/${d.tradeId}`} className="przejscie underline underline-offset-2 hover:text-text">
                              trade #{d.tradeId}
                            </Link>
                          </>
                        )}
                      </p>
                      <Markdown className="text-meta">{d.bodyMd}</Markdown>
                    </div>
                  ))}
                </section>
              )}

              {n.slowa.length > 0 && (
                <section aria-label="Słowa użytkownika" className="max-w-[68ch] space-y-5">
                  <h2 className="text-karta text-text">Twoje słowa przy tej notatce</h2>
                  {n.slowa.map((w) => (
                    <SlowaUzytkownikaNotatki key={w.id} wpis={{ ...w, historia: w.historia }} sciezka={sciezka} />
                  ))}
                </section>
              )}

              {!zarzadzana && (
                <div className="sticky bottom-20 z-[var(--z-przyklejone)] flex justify-end lg:bottom-4">
                  <Link href={`${sciezka}?tryb=edycja`} className={cx(klasaPigulki(false), "shadow-[var(--shadow-pop)]")}>
                    <Pencil size={14} aria-hidden /> Edytuj
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        {/* Panel „Linki” (wzór: Links z wyszukiwarką i listą powiązań). */}
        <aside aria-label="Linki" className="karta h-fit space-y-5 p-5 lg:sticky lg:top-20">
          <section aria-labelledby="backlinki">
            <h2 id="backlinki" className="text-karta text-text">
              Linki do tej notatki <span className="num text-meta text-muted">{n.backlinks.length}</span>
            </h2>
            <ul className="mt-2">
              {n.backlinks.length === 0 && <li className="text-meta text-muted">Żadna notatka tu nie linkuje.</li>}
              {n.backlinks.map((b) => (
                <li key={b.id} className="border-b border-line last:border-b-0">
                  <Link href={`/mozg/notatki/${b.id}`} className="przejscie flex min-h-10 items-center text-meta text-text hover:text-accent">
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="wychodzace" className="border-t border-line pt-4">
            <h2 id="wychodzace" className="text-karta text-text">
              Wzmianki <span className="num text-meta text-muted">{n.links.length}</span>
            </h2>
            <ul className="mt-2">
              {n.links.length === 0 && <li className="text-meta text-muted">Brak linków [[...]] w treści.</li>}
              {n.links.map((l) => (
                <li key={l.target} className="border-b border-line last:border-b-0">
                  {l.resolved ? (
                    <Link href={`/mozg/notatki/${l.resolved.id}`} className="przejscie flex min-h-10 items-center text-meta text-accent hover:text-accent-strong">
                      [[{l.resolved.title}]]
                    </Link>
                  ) : (
                    <span className="flex min-h-10 items-center text-meta text-muted">[[{l.target}]] · brak notatki</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {n.zalaczniki.length > 0 && (
            <section aria-labelledby="zalaczniki" className="border-t border-line pt-4">
              <h2 id="zalaczniki" className="text-karta text-text">
                Załączniki <span className="num text-meta text-muted">{n.zalaczniki.length}</span>
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {n.zalaczniki.map((z) => (
                  <a key={z.id} href={`/api/screenshots/${z.file}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-[var(--radius-tab)] border border-line">
                    <ObrazZrzutu loading="lazy" decoding="async" {...zrodlaZrzutu(z, "(max-width: 640px) 50vw, 400px")} alt={`Załącznik ${z.interval ?? ""}`} className="aspect-video w-full object-cover" />
                  </a>
                ))}
              </div>
            </section>
          )}
          <section aria-labelledby="rewizje" className="border-t border-line pt-4">
            <h2 id="rewizje" className="text-karta text-text">
              Rewizje <span className="num text-meta text-muted">{n.rewizje.length + 1}</span>
            </h2>
            <ol className="mt-2 space-y-1.5 text-meta">
              <li className="num text-text">
                r{n.rev} · obecna · {dateTime(n.updatedAt)}
              </li>
              {n.rewizje.map((r) => (
                <li key={r.rev} className="num text-muted">
                  r{r.rev} · {r.actor === "ui" ? "Ty" : r.actor.startsWith("api") ? "agent" : r.actor} · {dateTime(r.changedAt)}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
