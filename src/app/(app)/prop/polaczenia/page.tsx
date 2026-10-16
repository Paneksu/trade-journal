import Link from "next/link";

import { ZakladkiProp } from "@/components/etap3/zakladki-prop";
import type { PresetOpcja } from "@/components/etap3/formularze";
import { DoDecyzjiLista, KontaBrokeraLista } from "@/components/polaczenia/do-decyzji";
import { ImportReczny } from "@/components/polaczenia/import-reczny";
import { ImportyLista } from "@/components/polaczenia/importy";
import { ListaFirm } from "@/components/polaczenia/kreator";
import { PobierzTeraz } from "@/components/polaczenia/pobierz-teraz";
import { UzgodnioneLista } from "@/components/polaczenia/uzgodnione";
import { WynikNetto } from "@/components/polaczenia/wynik-netto";
import { PolaczeniaProvider, type KontoDziennika } from "@/components/polaczenia/wspolne";
import { Karta, NaglowekStrony, Strona } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { money } from "@/lib/format";
import { getAccounts } from "@/lib/queries/dictionaries";
import {
  doDecyzji,
  dzisiejszaData,
  instrumentyZKlasa,
  kontaPolaczone,
  kontaZeStawkami,
  listaFirmIPlatform,
  nettoZmienione,
  pominiete,
  odrzuconePliki,
  ostatnieImporty,
  stanAutomatu,
  stanOplat,
  uzgodnioneZRachunku,
} from "@/lib/queries/broker";
import { kontaProp, presetyProp } from "@/lib/queries/prop";

export const metadata = { title: "Połączenia — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

/*
 * Prop → Połączenia (ADR-034, etap A). Jeden wlot danych z rachunku: plik z eksportu wgrany ręcznie albo przysłany przez
 * automat łącznika (`tj watch-exports`). Strona nie przechowuje żadnych haseł ani kluczy do platform.
 */

const SEKCJE = [
  ["pobierz", "Pobierz teraz"],
  ["firmy", "Firmy i platformy"],
  ["konta-brokera", "Konta u brokera"],
  ["do-decyzji", "Do decyzji"],
  ["uzgodnione", "Uzgodnione"],
  ["import-reczny", "Import ręczny"],
  ["importy", "Historia importów"],
  ["wynik-netto", "Wynik netto"],
] as const;

export default async function PolaczeniaPage() {
  const ustawienia = await requireSession();
  const strefa = ustawienia.timezone ?? "Europe/Warsaw";
  const [firmy, polaczone, importy, uzgodnione, decyzje, netto, pomin, odrzucone, oplaty, stawki, klasy, automat, konta, propy, presety, dzis] = await Promise.all([
    listaFirmIPlatform(),
    kontaPolaczone(),
    ostatnieImporty(20),
    uzgodnioneZRachunku(30),
    doDecyzji(100),
    nettoZmienione(),
    pominiete(),
    odrzuconePliki(),
    stanOplat(),
    kontaZeStawkami(),
    instrumentyZKlasa(),
    stanAutomatu(),
    getAccounts(),
    kontaProp(),
    presetyProp(),
    dzisiejszaData(),
  ]);

  const zajete = new Map(polaczone.filter((k) => k.accountId !== null).map((k) => [k.accountId as number, k.brokerAccountId]));
  const maReguly = new Set(propy.konta.filter((k) => !("error" in k)).map((k) => k.accountId));
  const kontaDziennika: KontoDziennika[] = konta
    .filter((k) => !k.archived)
    .map((k) => ({ id: k.id, name: k.name, type: k.type, propPhase: k.propPhase, maReguly: maReguly.has(k.id), brokerAccountId: zajete.get(k.id) ?? null }));
  const presetyOpcje: PresetOpcja[] = presety.presets.map((p) => ({
    id: p.id,
    firm: p.firm,
    etykieta: `${p.program} · ${p.phase} · ${money(p.accountSizeCents, { decimals: 0 })}`,
    doWeryfikacji: p.needsVerification,
    wiekDni: p.ageDays,
    feeMiniCents: p.feeRtMiniCents,
    feeMicroCents: p.feeRtMicroCents,
    feeSourceUrl: p.feeSourceUrl,
  }));
  const aktywnyToken = automat.tokeny.some((t) => !t.revoked && !t.expired);
  const stanAut = { skonfigurowane: automat.skonfigurowane, aktywnyToken };

  return (
    <Strona className="space-y-6">
      <NaglowekStrony tytul="Prop" podtytul="Ile zostało do limitów, ile kosztują evale, ile wraca w wypłatach." />
      <ZakladkiProp aktywna="polaczenia" />
      <p className="text-karta text-muted">
        Przed notatką kliknij „Pobierz teraz”, wyeksportuj plik z platformy i gotowe: wynik trade&apos;ów będzie taki, jaki jest na rachunku. Dziennik nie łączy się z platformą i nie ma haseł ani kluczy. Czasy w strefie {strefa}.
      </p>
      <nav aria-label="Sekcje strony" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" data-przyciecie-zamierzone>
        {SEKCJE.map(([id, e]) => (
          <Link key={id} href={`#${id}`} className="przejscie inline-flex min-h-11 shrink-0 items-center rounded-full bg-surface-3 px-3.5 text-karta whitespace-nowrap text-text hover:bg-line-strong sm:min-h-8">
            {e}
          </Link>
        ))}
      </nav>

      <PolaczeniaProvider>
        <Karta id="pobierz" tytul="Pobierz teraz">
          <PobierzTeraz automat={stanAut} />
        </Karta>

        <Karta id="firmy" tytul="Firmy i platformy">
          <p className="mb-3 text-meta text-muted">Lista pochodzi z bazy i starzeje się w tygodniach: po 30 dniach od odczytu dziennik ostrzega, żeby sprawdzić stan na stronie firmy.</p>
          <ListaFirm firmy={firmy} konta={kontaDziennika} presety={presetyOpcje} dzis={dzis} automat={stanAut} />
        </Karta>

        <Karta id="konta-brokera" tytul="Konta u brokera">
          <KontaBrokeraLista polaczone={polaczone} konta={kontaDziennika} strefa={strefa} />
        </Karta>

        <Karta id="do-decyzji" tytul={`Do decyzji (${decyzje.length})`}>
          <DoDecyzjiLista wiersze={decyzje} odrzucone={odrzucone} strefa={strefa} nettoZmienione={netto} pominiete={pomin} />
        </Karta>

        <Karta id="uzgodnione" tytul="Uzgodnione z rachunku">
          <UzgodnioneLista wiersze={uzgodnione} strefa={strefa} />
        </Karta>

        <Karta id="import-reczny" tytul="Wgraj plik ręcznie">
          <p className="mb-3 text-meta text-muted">Ta sama ścieżka co automat, tylko bez łącznika (np. z telefonu). Plik jest czytany w pamięci i nie zostaje na serwerze.</p>
          <ImportReczny konta={kontaDziennika} strefaDomyslna={strefa} />
        </Karta>

        <Karta id="importy" tytul="Historia importów">
          <ImportyLista importy={importy} strefa={strefa} />
        </Karta>

        <Karta id="wynik-netto" tytul="Wynik netto">
          <WynikNetto stan={oplaty} konta={stawki} instrumenty={klasy} />
        </Karta>
      </PolaczeniaProvider>
    </Strona>
  );
}
