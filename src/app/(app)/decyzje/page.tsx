import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import { DecyzjaReguly, DecyzjaSetupu, DecyzjaSprzecznosci, DecyzjaSugestii, PotwierdzenieReguly } from "@/components/decyzje/formularze";
import { Markdown } from "@/components/trade/markdown";
import { Chip, NaglowekStrony, PustyStan } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { linkZDowodu } from "@/lib/api-v2/luki";
import { cx } from "@/lib/classes";
import { dateTime } from "@/lib/format";
import {
  propozycjeRegul,
  propozycjeSetupow,
  regulyKontDoPotwierdzenia,
  sprzecznosciDoRozstrzygniecia,
  sugestieDoDecyzji,
} from "@/lib/queries/decyzje";

export const metadata = { title: "Do decyzji — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

/*
 * Mózg: kolejka „Do decyzji” (UI v2, etap 2, wzór 8: Cycle, Refero a721db29). Po lewej kolejka, w środku JEDNA
 * pozycja z licznikiem „1 / n” i strzałkami (jedna decyzja naraz, plan: „jedna propozycja naraz”), po prawej panel
 * dowodów z najsilniejszym kontrargumentem. Sugestie AI i reguły kont prop zatwierdza się jednym kliknięciem
 * na liście (plan MUST 10). Zapis wyłącznie jako aktor `ui` (lib/decyzje); agent nie ma tej ścieżki.
 */

const POZIOMY: Record<string, string> = { tested: "przetestowane", partial: "częściowe", inferred: "wywnioskowane" };
const RODZAJE: Record<string, string> = {
  tag: "Tag",
  trade_link: "Powiązanie z notatką",
  setup_example: "Przykład setupu",
  process_grade: "Ocena procesu",
  trade_setup: "Setup trade'u",
  profile_term: "Hasło słownika",
  day_conclusion: "Wniosek dnia",
  weekly_conclusion: "Wniosek tygodnia",
  strategy_detail: "Dopisek do strategii",
};

/** Lista warunków z wersji setupu: obiekty {id, text} albo (stare dane) zwykłe napisy. */
function teksty(lista: unknown): string | null {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return lista.map((x) => (typeof x === "string" ? x : String((x as { text?: unknown }).text ?? ""))).join(" · ");
}

function czasZnacznika(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sek = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(sek).padStart(2, "0")}`;
}

function CelSugestii({ target }: { target: Record<string, unknown> }) {
  if (target.type === "trade")
    return (
      <Link href={`/trades/${String(target.id)}`} className="przejscie text-muted underline underline-offset-2 hover:text-text">
        trade #{String(target.id)}
      </Link>
    );
  if (target.type === "note")
    return (
      <Link href={`/mozg/notatki/${String(target.id)}`} className="przejscie text-muted underline underline-offset-2 hover:text-text">
        notatka #{String(target.id)}
      </Link>
    );
  if (target.type === "day") return <span>dzień {String(target.date)}</span>;
  if (target.type === "week") return <span>tydzień od {String(target.weekStart)}</span>;
  return <span>profil tradera</span>;
}

/** Dowody: lista `{type, ref, note}` jako numerowane pozycje; inne kształty jako tekst JSON (bez HTML). */
function Dowody({ dane }: { dane: unknown }) {
  const link = linkZDowodu(dane);
  const lista = Array.isArray(dane) ? (dane as Record<string, unknown>[]) : null;
  return (
    <div className="space-y-3">
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="przejscie inline-flex items-center gap-1 text-meta text-text underline underline-offset-2 hover:text-accent">
          Film mentora w miejscu cytatu <ExternalLink size={12} aria-hidden />
        </a>
      )}
      {lista ? (
        <ol className="border-t border-line">
          {lista.map((d, i) => (
            <li key={i} className="border-b border-line py-3 text-meta">
              <p className="num text-muted">
                [{i + 1}] {String(d.type ?? "dowód")}
                {d.type === "trade" && d.ref != null && (
                  <>
                    {" · "}
                    <Link href={`/trades/${String(d.ref)}`} className="przejscie underline underline-offset-2 hover:text-text">
                      #{String(d.ref)}
                    </Link>
                  </>
                )}
              </p>
              {typeof d.note === "string" && <p className="mt-1 text-text">{d.note}</p>}
            </li>
          ))}
        </ol>
      ) : dane != null ? (
        <pre className="num max-h-60 overflow-auto rounded-[var(--radius-tab)] border border-line bg-surface-2 p-3 text-grupa whitespace-pre-wrap text-muted">{JSON.stringify(dane, null, 2)}</pre>
      ) : (
        <p className="text-meta text-muted">Bez dowodów.</p>
      )}
    </div>
  );
}

type Pozycja =
  | { klucz: string; typ: "regula"; tytul: string; podpis: string; dane: Awaited<ReturnType<typeof propozycjeRegul>>[number] }
  | { klucz: string; typ: "setup"; tytul: string; podpis: string; dane: Awaited<ReturnType<typeof propozycjeSetupow>>[number] }
  | { klucz: string; typ: "sprzecznosc"; tytul: string; podpis: string; dane: Awaited<ReturnType<typeof sprzecznosciDoRozstrzygniecia>>[number] };

const NAZWA_TYPU: Record<Pozycja["typ"], string> = { regula: "Reguła", setup: "Wersja setupu", sprzecznosc: "Mentor kontra praktyka" };

export default async function DoDecyzjiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const [reguly, setupy, sugestie, regulyKont, sprzecznosci] = await Promise.all([
    propozycjeRegul(),
    propozycjeSetupow(),
    sugestieDoDecyzji(),
    regulyKontDoPotwierdzenia(),
    sprzecznosciDoRozstrzygniecia(),
  ]);

  const kolejka: Pozycja[] = [
    ...reguly.map((r) => ({ klucz: `r-${r.versionId}`, typ: "regula" as const, tytul: `${r.ruleCode}: ${r.title}`, podpis: r.podpis, dane: r })),
    ...setupy.map((s) => ({ klucz: `s-${s.versionId}`, typ: "setup" as const, tytul: `${s.name} · wersja ${s.version}`, podpis: s.podpis, dane: s })),
    ...sprzecznosci.map((m) => ({ klucz: `m-${m.id}`, typ: "sprzecznosc" as const, tytul: m.question, podpis: "wg mentora, n = 0", dane: m })),
  ];
  const indeks = Math.max(0, kolejka.findIndex((p) => p.klucz === sp.poz));
  const biezaca = kolejka[indeks] ?? null;
  const poprzednia = indeks > 0 ? kolejka[indeks - 1] : null;
  const nastepna = indeks < kolejka.length - 1 ? kolejka[indeks + 1] : null;
  const lacznie = kolejka.length + sugestie.oczekujace.length + regulyKont.length;

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-6">
      <NaglowekStrony
        tytul="Do decyzji"
        podtytul={`Oczekuje: ${lacznie}. Agent zgłasza reguły, setupy i sugestie; przyjmujesz je tylko Ty.`}
        akcje={
          <Link href="/mozg" className="przejscie text-meta text-muted underline underline-offset-2 hover:text-text">
            Mózg
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Kolejka (wzór: lista po lewej). */}
        <nav aria-label="Kolejka decyzji" className="order-2 space-y-5 lg:order-1">
          <div>
            <p className="mb-2 flex items-center justify-between text-meta text-muted">
              Jedna naraz <span className="num">{kolejka.length}</span>
            </p>
            {kolejka.length === 0 ? (
              <PustyStan tytul="Nic nie czeka na decyzję." opis="Propozycje reguł, setupów i sprzeczności pojawią się tu, gdy AI je zgłosi." akcja={{ href: "/mozg", etykieta: "Przejdź do Mózgu" }} />
            ) : (
              <ol className="space-y-1">
                {kolejka.map((p, i) => (
                  <li key={p.klucz}>
                    <Link
                      href={`/decyzje?poz=${p.klucz}`}
                      aria-current={i === indeks ? "page" : undefined}
                      className={cx(
                        "przejscie block rounded-[var(--radius-tab)] border px-3 py-2",
                        i === indeks ? "border-line-strong bg-panel" : "border-transparent hover:bg-panel",
                      )}
                    >
                      <span className="block text-grupa text-muted">{NAZWA_TYPU[p.typ]}</span>
                      <span className="block text-meta text-text">{p.tytul}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </nav>

        <div className="order-1 space-y-6 lg:order-2">
          {/* Jedna pozycja w środku + panel dowodów (wzór: Insights po prawej). */}
          {biezaca ? (
            <section aria-labelledby="pozycja" className="karta overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
                <div className="flex items-center gap-1">
                  {poprzednia ? (
                    <Link href={`/decyzje?poz=${poprzednia.klucz}`} aria-label="Poprzednia pozycja" className="przejscie flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
                      <ChevronUp size={16} aria-hidden />
                    </Link>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center text-line-strong" aria-hidden>
                      <ChevronUp size={16} />
                    </span>
                  )}
                  {nastepna ? (
                    <Link href={`/decyzje?poz=${nastepna.klucz}`} aria-label="Następna pozycja" className="przejscie flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text">
                      <ChevronDown size={16} aria-hidden />
                    </Link>
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center text-line-strong" aria-hidden>
                      <ChevronDown size={16} />
                    </span>
                  )}
                  <span className="num ml-1 text-meta text-muted">
                    {indeks + 1} / {kolejka.length}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className="h-6">{NAZWA_TYPU[biezaca.typ]}</Chip>
                  <Chip className="h-6">{biezaca.podpis}</Chip>
                </div>
              </div>

              <div className="grid xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-5 p-5 sm:p-6">
                  <h2 id="pozycja" className="text-sekcja text-text">
                    {biezaca.tytul}
                  </h2>

                  {biezaca.typ === "regula" && (
                    <>
                      <p className="num text-meta text-muted">
                        wersja {biezaca.dane.version} · zgłoszona {dateTime(biezaca.dane.proposedAt)}
                        {biezaca.dane.vaultStatus && ` · w sejfie: ${biezaca.dane.vaultStatus} (to informacja, nie zatwierdzenie)`}
                      </p>
                      <div>
                        <p className="mb-1.5 text-meta text-muted">Proponowana treść</p>
                        <Markdown>{biezaca.dane.textMd}</Markdown>
                      </div>
                      {biezaca.dane.obowiazujacyTekst && (
                        <div className="border-l-2 border-line-strong pl-3">
                          <p className="mb-1 text-meta text-muted">Obowiązuje teraz</p>
                          <Markdown className="text-meta text-muted [&_*]:text-muted">{biezaca.dane.obowiazujacyTekst}</Markdown>
                        </div>
                      )}
                      <div className="border-t border-line pt-5">
                        <DecyzjaReguly key={biezaca.dane.versionId} versionId={biezaca.dane.versionId} tekst={biezaca.dane.textMd} />
                      </div>
                    </>
                  )}

                  {biezaca.typ === "setup" && (
                    <>
                      <dl className="grid gap-x-4 gap-y-2 text-meta sm:grid-cols-[9rem_minmax(0,1fr)]">
                        {(
                          [
                            ["Warunki", teksty(biezaca.dane.wersja.preconditions)],
                            ["Checklista wejścia", teksty(biezaca.dane.wersja.entryChecklist)],
                            ["Stop", biezaca.dane.wersja.stopRule],
                            ["Cel", biezaca.dane.wersja.targetRule],
                            ["BE", biezaca.dane.wersja.beRule],
                            ["Unieważnienie", biezaca.dane.wersja.invalidation],
                            ["Czego unikać", biezaca.dane.wersja.avoid],
                          ] as const
                        ).map(([k, v]) =>
                          v ? (
                            <div key={k} className="contents">
                              <dt className="text-muted">{k}</dt>
                              <dd className="text-text">{v}</dd>
                            </div>
                          ) : null,
                        )}
                        <dt className="text-muted">Progi statusu</dt>
                        <dd className="num text-text">{JSON.stringify(biezaca.dane.wersja.thresholds)}</dd>
                      </dl>
                      <div className="border-t border-line pt-5">
                        <DecyzjaSetupu
                          key={biezaca.dane.versionId}
                          versionId={biezaca.dane.versionId}
                          wersja={{
                            stopRule: biezaca.dane.wersja.stopRule,
                            targetRule: biezaca.dane.wersja.targetRule,
                            beRule: biezaca.dane.wersja.beRule,
                            invalidation: biezaca.dane.wersja.invalidation,
                            avoid: biezaca.dane.wersja.avoid,
                          }}
                        />
                      </div>
                    </>
                  )}

                  {biezaca.typ === "sprzecznosc" && (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <section aria-label="Wg mentora" className="space-y-2">
                          <p className="text-meta text-muted">wg mentora</p>
                          <blockquote className="border-l-2 border-line-strong pl-3 text-karta whitespace-pre-wrap text-text">{biezaca.dane.mentor.quote}</blockquote>
                          <a href={biezaca.dane.mentor.link} target="_blank" rel="noopener noreferrer" className="przejscie inline-flex items-center gap-1 text-meta text-muted underline underline-offset-2 hover:text-text">
                            {biezaca.dane.mentor.videoTitle}, {czasZnacznika(biezaca.dane.mentor.tStartS)} (t={biezaca.dane.mentor.tStartS}) <ExternalLink size={12} aria-hidden />
                          </a>
                        </section>
                        <section aria-label="Twoje słowa" className="space-y-2">
                          <p className="text-meta text-muted">Słowa użytkownika</p>
                          {biezaca.dane.slowaUzytkownika.length === 0 ? (
                            <p className="text-meta text-muted">Do tej sprzeczności nie jest przypięty żaden Twój wpis.</p>
                          ) : (
                            biezaca.dane.slowaUzytkownika.map((w) => (
                              <blockquote key={w.id} className="border-l-2 border-accent pl-3 text-karta whitespace-pre-wrap text-text">
                                {w.text}
                              </blockquote>
                            ))
                          )}
                          {biezaca.dane.noteId && (
                            <Link href={`/mozg/notatki/${biezaca.dane.noteId}`} className="przejscie text-meta text-muted underline underline-offset-2 hover:text-text">
                              notatka
                            </Link>
                          )}
                        </section>
                      </div>
                      <div className="border-t border-line pt-5">
                        <DecyzjaSprzecznosci key={biezaca.dane.id} id={biezaca.dane.id} />
                      </div>
                    </>
                  )}
                </div>

                <aside aria-label="Dowody" className="space-y-5 border-t border-line bg-bg/30 p-5 xl:border-t-0 xl:border-l">
                  {biezaca.typ === "regula" && (
                    <>
                      {biezaca.dane.counterargument && (
                        <div>
                          <p className="mb-1.5 text-meta text-muted">Najsilniejszy kontrargument</p>
                          <p className="text-meta whitespace-pre-wrap text-text">{biezaca.dane.counterargument}</p>
                        </div>
                      )}
                      <div>
                        <p className="mb-1.5 text-meta text-muted">Dowody</p>
                        <Dowody dane={biezaca.dane.evidence} />
                      </div>
                    </>
                  )}
                  {biezaca.typ === "setup" && (
                    <>
                      {biezaca.dane.wersja.counterargument && (
                        <div>
                          <p className="mb-1.5 text-meta text-muted">Najsilniejszy kontrargument</p>
                          <p className="text-meta text-text">{biezaca.dane.wersja.counterargument}</p>
                        </div>
                      )}
                      <div>
                        <p className="mb-1.5 text-meta text-muted">Dowody</p>
                        <Dowody dane={biezaca.dane.wersja.evidence} />
                      </div>
                    </>
                  )}
                  {biezaca.typ === "sprzecznosc" && (
                    <div className="space-y-2 text-meta">
                      <p className="text-muted">Zgłoszona {dateTime(biezaca.dane.createdAt)}</p>
                      {biezaca.dane.setup && <p className="text-text">Setup: {biezaca.dane.setup.name}</p>}
                      {biezaca.dane.tradeId && (
                        <Link href={`/trades/${biezaca.dane.tradeId}`} className="przejscie text-muted underline underline-offset-2 hover:text-text">
                          Trade #{biezaca.dane.tradeId}
                        </Link>
                      )}
                      <p className="text-muted">AI tej sprzeczności nie rozstrzyga.</p>
                    </div>
                  )}
                </aside>
              </div>
            </section>
          ) : (
            <section className="karta p-6">
              <h2 className="text-sekcja text-text">Nic w kolejce propozycji</h2>
              <p className="mt-1 text-meta text-muted">Gdy AI, mentor albo import zgłosi regułę, wersję setupu albo sprzeczność, pojawi się tutaj.</p>
            </section>
          )}

          {/* Jednym kliknięciem (plan MUST 10): sugestie AI i reguły kont prop. */}
          <section aria-labelledby="sugestie" className="space-y-3">
            <h2 id="sugestie" className="text-sekcja text-text">
              Sugestie AI <span className="num text-meta text-muted">{sugestie.oczekujace.length}</span>
            </h2>
            {sugestie.oczekujace.length === 0 ? (
              <p className="text-meta text-muted">Brak oczekujących sugestii. Do zatwierdzenia nie wchodzą do statystyk.</p>
            ) : (
              <ul className="border-t border-line">
                {sugestie.oczekujace.map((s) => (
                  <li key={s.id} className="space-y-2 border-b border-line py-4">
                    <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
                      <Chip className="h-6">{RODZAJE[s.kind] ?? s.kind}</Chip>
                      <span>propozycja AI</span>
                      <span>· {POZIOMY[s.evidenceLevel]}</span>
                      {s.n !== null && <span className="num">· n = {s.n}</span>}
                      <span>·</span>
                      <CelSugestii target={s.target as Record<string, unknown>} />
                    </div>
                    <p className="text-karta text-text">{s.claim}</p>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <details className="text-meta">
                        <summary className="przejscie cursor-pointer text-muted hover:text-text">Dowody</summary>
                        <div className="mt-2 sm:w-[520px]">
                          <Dowody dane={s.evidence} />
                        </div>
                      </details>
                      <DecyzjaSugestii id={s.id} zatwierdzona={false} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="prop" className="space-y-3">
            <h2 id="prop" className="text-sekcja text-text">
              Reguły kont prop do potwierdzenia <span className="num text-meta text-muted">{regulyKont.length}</span>
            </h2>
            <p className="text-meta text-muted">Dopóki nie potwierdzisz zgodności z regulaminem firmy, bufory liczą się na ostrzejszej z reguł.</p>
            {regulyKont.length > 0 && (
              <ul className="border-t border-line">
                {regulyKont.map((r) => (
                  <li key={r.id} className="space-y-2 border-b border-line py-4">
                    <div className="flex flex-wrap items-center gap-2 text-meta text-muted">
                      <span className="text-karta text-text">{r.accountName}</span>
                      <Chip className="h-6">niepotwierdzone</Chip>
                      {r.preset && <span>{r.preset.firm} · {r.preset.program} · {r.preset.phase}</span>}
                      {r.preset?.needsVerification && <span>· preset do weryfikacji</span>}
                      <span className="num">· od {r.validFrom}</span>
                    </div>
                    <p className="num text-meta text-text">
                      DD {r.rule.ddType} {(r.rule.maxDdCents / 100).toFixed(0)} USD · limit dnia {r.rule.dailyLossCents === null ? "brak" : `${(r.rule.dailyLossCents / 100).toFixed(0)} USD`} · consistency{" "}
                      {r.rule.consistencyPct === null ? "brak" : `${r.rule.consistencyPct}%`}
                    </p>
                    {r.rule.sourceUrl && <p className="text-meta break-all text-muted">Źródło: {r.rule.sourceUrl}</p>}
                    <PotwierdzenieReguly id={r.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sugestie.zatwierdzone.length > 0 && (
            <section aria-labelledby="cofnij" className="space-y-3">
              <h2 id="cofnij" className="text-sekcja text-text">
                Zatwierdzone (do cofnięcia) <span className="num text-meta text-muted">{sugestie.zatwierdzone.length}</span>
              </h2>
              <ul className="border-t border-line">
                {sugestie.zatwierdzone.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
                    <p className="min-w-0 text-meta">
                      <span className="text-muted">{RODZAJE[s.kind] ?? s.kind} · </span>
                      <span className="text-text">{s.claim}</span>
                    </p>
                    <DecyzjaSugestii id={s.id} zatwierdzona />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
