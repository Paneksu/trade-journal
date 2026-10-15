import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";

import { Chip, NaglowekStrony, Pigulka } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { cx } from "@/lib/classes";
import { shortDate } from "@/lib/format";
import { licznikiDoDecyzji } from "@/lib/queries/decyzje";
import {
  hipotezyMozgu,
  licznikiMozgu,
  lukiMozgu,
  NAZWY_KINDOW,
  NAZWY_WIDOKOW,
  notatkiWidoku,
  profilMozgu,
  regulyMozgu,
  WIDOKI_MOZGU,
  type WidokMozgu,
} from "@/lib/queries/mozg";

export const metadata = { title: "Mózg — Dziennik tradingowy" };

/*
 * Mózg (UI v2, etap 2). Forma ze wzoru 4 (profil Linear, Refero 4a094449): lista w grupach z paskiem nagłówka
 * po lewej, prawy panel ok. 320 px z podsumowaniem (u nas: profil tradera i miara poprawionych interpretacji).
 * Zakładki widoków jak „Assigned / Created” we wzorze. Marka: liczby w Plex Mono, akcent tylko na aktywnej
 * zakładce i głównej akcji, „propozycja AI” zawsze podpisana.
 */

const STATUSY_REGUL: Record<string, string> = { active: "Aktywne", proposed: "Propozycje", retired: "Wycofane", rejected: "Odrzucone" };
const FAZY: Record<string, string> = { zbieranie: "zbieranie", do_oceny: "do oceny" };
const DECYZJE_HIPOTEZ: Record<string, string> = { active: "aktywna", confirmed: "potwierdzona", rejected: "odrzucona", abandoned: "porzucona" };
const STATUSY_LUK: Record<string, string> = { open: "otwarta", asked: "zadana", answered: "z odpowiedzią", dismissed: "odrzucona" };

function Grupa({ tytul, liczba, children }: { tytul: string; liczba: number; children: React.ReactNode }) {
  return (
    <section aria-label={tytul}>
      <h2 className="flex h-9 items-center gap-2 border-y border-line bg-panel px-3 text-meta text-text">
        {tytul} <span className="num text-muted">{liczba}</span>
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function Wiersz({ href, kod, tytul, children }: { href: string | null; kod?: string; tytul: string; children?: React.ReactNode }) {
  const tresc = (
    <>
      {kod && <span className="num w-14 shrink-0 text-meta text-muted">{kod}</span>}
      <span className="min-w-0 flex-1 text-karta text-text">{tytul}</span>
      <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{children}</span>
    </>
  );
  return (
    <li className="border-b border-line">
      {href ? (
        <Link href={href} className="przejscie flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-panel sm:flex-nowrap">
          {tresc}
        </Link>
      ) : (
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap">{tresc}</div>
      )}
    </li>
  );
}

export default async function MozgPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const widok: WidokMozgu = (WIDOKI_MOZGU as readonly string[]).includes(String(sp.widok)) ? (sp.widok as WidokMozgu) : "reguly";
  const status = typeof sp.status === "string" ? sp.status : null;

  const [liczniki, profil, decyzje] = await Promise.all([licznikiMozgu(), profilMozgu(), licznikiDoDecyzji()]);
  const doDecyzji = decyzje.decyzje + decyzje.rozstrzygniecia;
  const ostatniMiesiac = profil.correctionRate.at(-1) ?? null;

  let tresc: React.ReactNode = null;
  if (widok === "reguly") {
    const { reguly, rulesVersion } = await regulyMozgu();
    const grupy = (["proposed", "active", "retired", "rejected"] as const)
      .map((s) => [s, reguly.filter((r) => (s === "proposed" ? r.pendingProposal : r.status === s))] as const)
      .filter(([s, lista]) => lista.length > 0 && (!status || status === s));
    tresc = (
      <>
        <nav aria-label="Filtr statusu reguł" className="mb-3 flex flex-wrap items-center gap-2 text-meta">
          {[null, "active", "proposed", "retired"].map((s) => (
            <Link
              key={s ?? "wszystkie"}
              href={s ? `/mozg?widok=reguly&status=${s}` : "/mozg?widok=reguly"}
              aria-current={status === s ? "true" : undefined}
              className={cx(
                "przejscie inline-flex h-7 items-center rounded-full border px-3",
                status === s ? "border-text/40 bg-surface-3 text-text" : "border-line text-muted hover:text-text",
              )}
            >
              {s ? STATUSY_REGUL[s] : "Wszystkie"}
            </Link>
          ))}
          <span className="num ml-auto text-muted">zestaw reguł v{rulesVersion}</span>
        </nav>
        {grupy.length === 0 && <p className="py-10 text-center text-meta text-muted">Brak reguł w tym filtrze.</p>}
        {grupy.map(([s, lista]) => (
          <Grupa key={s} tytul={STATUSY_REGUL[s]} liczba={lista.length}>
            {lista.map((r) => (
              <Wiersz key={r.code} href={`/mozg/notatki/${r.noteId}`} kod={r.code} tytul={r.title}>
                {r.hard && <Chip className="h-6">twarda</Chip>}
                {r.proposal && <Chip className="h-6">{r.proposal.podpis}</Chip>}
                <span className="num text-meta text-muted">v{r.current?.version ?? r.proposal?.version ?? "—"}</span>
              </Wiersz>
            ))}
          </Grupa>
        ))}
      </>
    );
  } else if (widok === "hipotezy") {
    const hipotezy = await hipotezyMozgu();
    tresc = (
      <Grupa tytul="Hipotezy" liczba={hipotezy.length}>
        {hipotezy.map((h) => (
          <Wiersz key={h.code} href={`/mozg/notatki/${h.noteId}`} kod={h.code} tytul={h.title}>
            <span className="flex w-36 flex-col gap-1">
              <span className="num text-right text-meta text-text">
                n = {h.n} <span className="text-muted">/ {h.progN}</span>
              </span>
              <span
                role="meter"
                aria-label={`${h.code}: ${h.n} z ${h.progN} obserwacji`}
                aria-valuemin={0}
                aria-valuemax={h.progN}
                aria-valuenow={Math.min(h.n, h.progN)}
                className="h-1 w-full overflow-hidden rounded-full bg-surface-3"
              >
                <span className="block h-full bg-text/70" style={{ width: `${Math.min(100, (h.n / h.progN) * 100)}%` }} />
              </span>
            </span>
            <Chip className="h-6">{FAZY[h.phase]}</Chip>
            {h.decision !== "active" && <Chip className="h-6">{DECYZJE_HIPOTEZ[h.decision]}</Chip>}
            <span className={cx("num w-24 text-right text-meta", h.warianty > 1 ? "text-accent-strong" : "text-muted")} title="Liczba testowanych wariantów: im więcej, tym bardziej zawyżony najlepszy wynik">
              {h.warianty} {h.warianty === 1 ? "wariant" : "wariantów"}
            </span>
          </Wiersz>
        ))}
      </Grupa>
    );
  } else if (widok === "luki") {
    const luki = await lukiMozgu();
    tresc = (
      <Grupa tytul="Luki strategii" liczba={luki.length}>
        {luki.map((l) => (
          <Wiersz key={l.id} href={l.noteId ? `/mozg/notatki/${l.noteId}` : null} tytul={l.question}>
            {l.setup && <Chip className="h-6">{l.setup.name}</Chip>}
            <Chip className="h-6">{STATUSY_LUK[l.status]}</Chip>
            {l.origin === "ai" && <span className="text-meta text-muted">propozycja AI</span>}
          </Wiersz>
        ))}
      </Grupa>
    );
  } else {
    const lista = await notatkiWidoku(widok);
    tresc = (
      <Grupa tytul={NAZWY_WIDOKOW[widok]} liczba={lista.length}>
        {lista.length === 0 && <li className="px-3 py-10 text-center text-meta text-muted">Pusto. Notatki dopisze AI albo Ty.</li>}
        {lista.map((n) => (
          <Wiersz key={n.id} href={`/mozg/notatki/${n.id}`} tytul={n.title}>
            <Chip className="h-6">{NAZWY_KINDOW[n.kind] ?? n.kind}</Chip>
            {n.origin === "ai" && <span className="text-meta text-muted">AI</span>}
            <span className="num w-12 text-right text-meta text-muted">{shortDate(n.updatedAt.slice(0, 10))}</span>
          </Wiersz>
        ))}
      </Grupa>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6">
      <NaglowekStrony
        tytul="Mózg"
        podtytul="Reguły, hipotezy i notatki strategii. Agent proponuje, zatwierdzasz tylko Ty."
        akcje={
          <>
            <Pigulka href="/decyzje">
              Do decyzji <span className="num text-muted">{doDecyzji}</span>
            </Pigulka>
            <Pigulka href="/mozg/notatki/nowa" glowna>
              <Plus size={15} aria-hidden /> Nowa notatka
            </Pigulka>
          </>
        }
      />

      <nav
        aria-label="Widoki Mózgu"
        data-przyciecie-zamierzone
        className="-mx-4 overflow-x-auto border-b border-line px-4 pb-2 [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mx-0 sm:px-0 sm:[mask-image:none]"
      >
        <ul className="flex min-w-max gap-1">
          {WIDOKI_MOZGU.map((w) => (
            <li key={w}>
              <Link
                href={`/mozg?widok=${w}`}
                aria-current={w === widok ? "page" : undefined}
                className={cx(
                  "przejscie inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-tab)] px-3 text-karta",
                  w === widok ? "bg-accent-dim text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {NAZWY_WIDOKOW[w]} <span className="num text-meta opacity-80">{liczniki[w]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">{tresc}</div>

        {/* Prawy panel jak profil we wzorze: kim jest trader dla AI i jak często AI go nie rozumie. */}
        <aside aria-label="Profil tradera" className="karta h-fit space-y-5 p-5">
          <div>
            <p className="text-meta text-muted">Poprawione interpretacje AI</p>
            <p className="num mt-1 text-liczba font-medium text-text">
              {ostatniMiesiac?.rate === null || ostatniMiesiac === null ? "—" : `${Math.round(ostatniMiesiac.rate * 100)}%`}
            </p>
            <p className="num text-meta text-muted">
              {ostatniMiesiac ? `${ostatniMiesiac.corrected} z ${ostatniMiesiac.interpreted} w ${ostatniMiesiac.month}` : "brak interpretacji"} · powinno spadać
            </p>
            {profil.correctionRate.length > 1 && (
              <div className="mt-3 flex h-12 items-end gap-1" role="img" aria-label="Odsetek poprawionych interpretacji w kolejnych miesiącach">
                {profil.correctionRate.map((m) => (
                  <span key={m.month} title={`${m.month}: ${m.rate === null ? "—" : `${Math.round(m.rate * 100)}%`}`} className="flex-1 rounded-t-[3px] bg-text/50" style={{ height: `${Math.max(6, (m.rate ?? 0) * 100)}%` }} />
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-line pt-4">
            <p className="text-meta text-muted">Słownik tradera</p>
            <ul className="mt-2 space-y-1.5">
              {profil.terms.slice(0, 4).map((t) => (
                <li key={t.id} className="text-meta">
                  <span className="text-text">{t.term}</span>
                  <span className="text-muted"> → {t.meaning}</span>
                  {t.status === "proposed" && <span className="text-muted"> · propozycja AI</span>}
                </li>
              ))}
              {profil.terms.length === 0 && <li className="text-meta text-muted">Pusty. Hasła dopisują się z Twoich poprawek.</li>}
            </ul>
          </div>
          <div className="border-t border-line pt-4">
            <p className="num text-meta text-muted">
              Werdykty AI zmienione przez Ciebie: <span className="text-text">{profil.verdicts.changedByUser}</span> z {profil.verdicts.aiVerdicts}
            </p>
          </div>
          <Link href="/mozg/profil" className="przejscie inline-flex items-center gap-0.5 text-karta text-muted hover:text-text">
            Profil i słownik <ChevronRight size={15} aria-hidden />
          </Link>
        </aside>
      </div>
    </div>
  );
}
