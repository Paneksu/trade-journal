"use client";

import { useActionState, useState, startTransition } from "react";
import { useRouter } from "next/navigation";

import { FormularzPresetu, type PresetOpcja } from "@/components/etap3/formularze";
import { Chip } from "@/components/ui/v2";
import { saveAccount, type ActionState } from "@/lib/actions/settings";
import { cx } from "@/lib/classes";
import { shortDate } from "@/lib/format";
import type { FirmaZPlatformami, PlatformaFirmy } from "@/lib/queries/broker";

import { PobierzTeraz, type StanAutomatuUi } from "./pobierz-teraz";
import { klasaPrzycisku, Modal, POLE_KLASA, usePreferowaneKonto, type KontoDziennika } from "./wspolne";

/*
 * Kreator »Połącz« (ADR-034 pkt 1): platforma, konto dziennika (z presetem i stawką opłat), instrukcja eksportu i »Pobierz teraz«.
 * Nie zapisuje żadnego poświadczenia: nie ma haseł ani kluczy. OAuth Tradovate jest wyłączony do pisemnego potwierdzenia dostępu
 * tylko do odczytu (flaga w kodzie i w Coolify).
 */

const dataPL = (iso: string): string => shortDate(iso);
const tradovate = (p: PlatformaFirmy): boolean => p.platform.toLowerCase().includes("tradovate");
const pasuje = (a: string, b: string): boolean => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(y) || y.startsWith(x) || x.split(" ")[0] === y.split(" ")[0];
};

export function ListaFirm({ firmy, ...reszta }: { firmy: FirmaZPlatformami[] } & Omit<KreatorProps, "cel" | "zamknij">) {
  const [cel, setCel] = useState<{ firma: string; platforma: PlatformaFirmy } | null>(null);
  return (
    <>
      <ul>
        {firmy.map((f) => (
          <li key={f.firm} className="border-b border-line py-3" data-testid={`firma-${f.firm}`}>
            <p className="text-karta text-text">{f.firm}</p>
            <ul className="mt-2 space-y-3">
              {f.platformy.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-karta text-text">
                      {p.platform}
                      {p.needsVerification && <Chip className="h-5 border-dashed">do weryfikacji</Chip>}
                      <Chip className="h-5">{p.maParser ? "plik rozpoznawany" : "plik jeszcze nierozpoznawany"}</Chip>
                    </p>
                    <p className="text-meta text-muted">
                      Odczyt listy: <span className="num">{dataPL(p.readOn)}</span>
                      {p.stale && (
                        <span className="text-text" data-testid={`stan-stary-${p.id}`}>
                          {" "}· stan z {dataPL(p.readOn)}, sprawdź na stronie firmy
                        </span>
                      )}
                      {" · "}
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">
                        źródło
                      </a>
                    </p>
                    {p.notes && <p className="text-meta text-muted">{p.notes}</p>}
                  </div>
                  <button type="button" data-testid={`polacz-${p.id}`} className={klasaPrzycisku(false)} onClick={() => setCel({ firma: f.firm, platforma: p })}>
                    Połącz
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {cel && <Kreator cel={cel} zamknij={() => setCel(null)} {...reszta} />}
    </>
  );
}

type KreatorProps = {
  cel: { firma: string; platforma: PlatformaFirmy };
  zamknij: () => void;
  konta: KontoDziennika[];
  presety: PresetOpcja[];
  dzis: string;
  automat: StanAutomatuUi;
};

function NoweKonto({ onUtworzone }: { onUtworzone: () => void }) {
  const [typ, setTyp] = useState("prop");
  const [stan, akcja, trwa] = useActionState<ActionState, FormData>(async (p, d) => {
    const w = await saveAccount(p, d);
    if (w.ok) onUtworzone();
    return w;
  }, {});
  return (
    <form
      className="space-y-3 rounded-[var(--radius-tab)] border border-line-strong p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => akcja(fd));
      }}
      data-testid="kreator-nowe-konto"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor="nk-nazwa" className="block text-meta text-muted">Nazwa konta w dzienniku</label>
          <input id="nk-nazwa" name="name" required autoComplete="off" className={POLE_KLASA} data-testid="kreator-nazwa" />
        </div>
        <div className="space-y-1">
          <label htmlFor="nk-typ" className="block text-meta text-muted">Typ</label>
          <select id="nk-typ" name="type" value={typ} onChange={(e) => setTyp(e.target.value)} className={cx(POLE_KLASA, "cursor-pointer")}>
            <option value="prop">prop firm</option>
            <option value="live">realne</option>
            <option value="demo">demo</option>
          </select>
        </div>
        {typ === "prop" && (
          <div className="space-y-1">
            <label htmlFor="nk-faza" className="block text-meta text-muted">Faza</label>
            <select id="nk-faza" name="propPhase" defaultValue="eval" className={cx(POLE_KLASA, "cursor-pointer")}>
              <option value="eval">eval (challenge)</option>
              <option value="funded">funded</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="nk-saldo" className="block text-meta text-muted">Saldo startowe (USD)</label>
          <input id="nk-saldo" name="startingBalance" inputMode="decimal" defaultValue="0" autoComplete="off" className={cx(POLE_KLASA, "num")} />
        </div>
      </div>
      <input type="hidden" name="currency" value="USD" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" data-testid="kreator-utworz-konto" className={klasaPrzycisku(true)} disabled={trwa}>
          {trwa ? "Tworzę…" : "Utwórz konto"}
        </button>
        {stan.error && <span role="alert" className="text-meta text-loss">{stan.error}</span>}
        {stan.ok && <span role="status" className="text-meta text-muted">Konto utworzone.</span>}
      </div>
    </form>
  );
}

function Kreator({ cel, zamknij, konta, presety, dzis, automat }: KreatorProps) {
  const router = useRouter();
  const { ustaw } = usePreferowaneKonto();
  const { firma, platforma } = cel;
  const [krok, setKrok] = useState<1 | 2 | 3>(1);
  const [tryb, setTryb] = useState<"istniejace" | "nowe">("istniejace");
  const [wybrane, setWybrane] = useState<number | null>(null);
  const [czekaNaNowe, setCzekaNaNowe] = useState(false);
  const [znane] = useState(() => new Set(konta.map((k) => k.id)));

  // Nowo utworzone konto: pierwsze, którego nie było przy otwarciu kreatora (po odświeżeniu danych strony).
  const nowe = czekaNaNowe ? konta.find((k) => !znane.has(k.id)) : undefined;
  const idKonta = wybrane ?? nowe?.id ?? null;
  const konto = konta.find((k) => k.id === idKonta) ?? null;
  const presetyFirmy = presety.filter((p) => pasuje(p.firm, firma));

  const wybierz = (id: number | null) => setWybrane(id);

  return (
    <Modal open onOpenChange={(o) => !o && zamknij()} tytul={`Połącz: ${firma}, ${platforma.platform}`} opis={`Krok ${krok} z 3`} testid="kreator">
      {krok === 1 && (
        <div className="space-y-4">
          {platforma.maParser ? (
            <>
              <p className="text-karta text-text">Dziennik zna format pliku z tej platformy. Połączenie to jeden wlot: wyeksportujesz plik w platformie, a dziennik go odczyta.</p>
              <ul className="list-disc space-y-1 pl-5 text-meta text-muted">
                <li>Dziennik niczego nie zapisuje do platformy i nie przechowuje żadnych haseł ani kluczy.</li>
                <li>Konto u brokera pojawi się w dzienniku dopiero po pierwszym imporcie pliku.</li>
              </ul>
            </>
          ) : (
            <div role="status" className="space-y-2 rounded-[var(--radius-tab)] border border-line-strong p-3" data-testid="kreator-bez-parsera">
              <p className="text-karta text-text">Dziennik nie rozpoznaje jeszcze pliku platformy {platforma.platform}.</p>
              <p className="text-meta text-muted">
                Parser powstaje wyłącznie z prawdziwego pliku eksportu tej platformy, a takiego jeszcze nie mam, więc nie udaję, że to połączę. Nadal możesz wpisywać trade&apos;y ręcznie albo z notatki.
              </p>
              {platforma.exportHint && <p className="text-meta text-muted">Wskazówka z listy firm: {platforma.exportHint}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {platforma.maParser && (
              <button type="button" data-testid="kreator-dalej-1" className={klasaPrzycisku(true)} onClick={() => setKrok(2)}>
                Dalej: konto dziennika
              </button>
            )}
            <button type="button" className={klasaPrzycisku(false)} onClick={zamknij}>
              Zamknij
            </button>
          </div>
        </div>
      )}

      {krok === 2 && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-karta text-text">Konto dziennika dla tej platformy</legend>
            <div className="flex flex-wrap gap-2">
              {(["istniejace", "nowe"] as const).map((t) => (
                <label key={t} className={cx("przejscie inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-karta has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 sm:min-h-8", tryb === t ? "border-text text-text" : "border-line-strong text-muted")}>
                  <input type="radio" name="tryb-konta" value={t} checked={tryb === t} onChange={() => setTryb(t)} className="sr-only" data-testid={`kreator-tryb-${t}`} />
                  {t === "istniejace" ? "Istniejące konto" : "Nowe konto"}
                </label>
              ))}
            </div>
          </fieldset>

          {tryb === "istniejace" ? (
            <div className="space-y-1">
              <label htmlFor="kr-konto" className="block text-meta text-muted">Konto w dzienniku</label>
              <select id="kr-konto" data-testid="kreator-konto" value={idKonta ?? ""} onChange={(e) => wybierz(e.target.value === "" ? null : Number(e.target.value))} className={cx(POLE_KLASA, "cursor-pointer")}>
                <option value="">Wybierz konto</option>
                {konta.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.type}{k.propPhase ? `, ${k.propPhase}` : ""}){k.brokerAccountId !== null ? " · ma już konto u brokera" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <NoweKonto
              onUtworzone={() => {
                setCzekaNaNowe(true);
                router.refresh();
              }}
            />
          )}
          {tryb === "nowe" && czekaNaNowe && (
            <p role="status" className="text-meta text-muted">
              {konto ? <>Wybrano nowe konto: <span className="text-text">{konto.name}</span>.</> : "Odświeżam listę kont…"}
            </p>
          )}

          {konto && konto.type === "prop" && !konto.maReguly && (
            <div className="space-y-2 border-t border-line pt-4" data-testid="kreator-preset">
              <h3 className="text-karta text-text">Preset firmy</h3>
              <p className="text-meta text-muted">Preset wyznacza limity i stawkę opłat od daty zakupu konta. Faza konta (eval albo funded) pochodzi z presetu.</p>
              <FormularzPresetu accountId={konto.id} presety={presetyFirmy.length > 0 ? presetyFirmy : presety} dzis={dzis} onZapisano={() => router.refresh()} />
            </div>
          )}
          {konto && konto.type === "prop" && konto.maReguly && <p className="text-meta text-muted">Konto ma już przypięte reguły. Zmienisz je na ekranie konta w Prop.</p>}
          {konto && konto.type !== "prop" && <p className="text-meta text-muted">Stawki opłat tego konta ustawisz w sekcji „Wynik netto” poniżej albo w Ustawieniach.</p>}
          {konto && konto.brokerAccountId !== null && <p className="text-meta text-loss">To konto ma już przypisane konto u brokera. Jedno konto dziennika ma co najwyżej jedno konto u brokera; odepnij je w sekcji „Konta u brokera”.</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="kreator-dalej-2" className={klasaPrzycisku(true)} disabled={!konto} onClick={() => {
                ustaw(idKonta);
                setKrok(3);
              }}>
              Dalej: eksport
            </button>
            <button type="button" className={klasaPrzycisku(false)} onClick={() => setKrok(1)}>
              Wstecz
            </button>
          </div>
        </div>
      )}

      {krok === 3 && (
        <div className="space-y-4">
          {tradovate(platforma) ? <InstrukcjaTradovate /> : <p className="text-karta text-text">{platforma.exportHint ?? "Wyeksportuj historię transakcji do pliku CSV."}</p>}
          {konto && (
            <p className="text-meta text-muted" data-testid="kreator-konto-info">
              Po pierwszym imporcie wskaż konto <span className="text-text">{konto.name}</span> przy nowym koncie u brokera (w podglądzie importu albo w sekcji „Konta u brokera”).
            </p>
          )}
          <PobierzTeraz automat={automat} sufiks="-kreator" />
          {tradovate(platforma) && (
            <div className="space-y-1 border-t border-line pt-4">
              <button type="button" disabled aria-disabled="true" aria-describedby="oauth-opis" data-testid="kreator-oauth" className={klasaPrzycisku(false)}>
                Połącz z Tradovate
              </button>
              <p id="oauth-opis" className="text-meta text-muted">Tradovate nie potwierdził jeszcze dostępu tylko do odczytu.</p>
            </div>
          )}
          <p className="text-meta text-muted">Zakończenie kreatora niczego nie zapisuje: nie ma haseł ani kluczy do tej platformy.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="kreator-gotowe" className={klasaPrzycisku(true)} onClick={zamknij}>
              Gotowe
            </button>
            <button type="button" className={klasaPrzycisku(false)} onClick={() => setKrok(2)}>
              Wstecz
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function InstrukcjaTradovate() {
  return (
    <div className="space-y-2" data-testid="kreator-instrukcja">
      <h3 className="text-karta text-text">Eksport z Tradovate (przeglądarka albo aplikacja desktop)</h3>
      <ol className="list-decimal space-y-1.5 pl-5 text-karta text-text">
        <li>Przełącz się na konto prop, z którego chcesz plik. Jedno konto na jeden eksport.</li>
        <li>Kliknij Reports na pasku bocznym albo pasek z saldem u góry. Otworzy się okno Account Reports.</li>
        <li>Zakładka Orders: ustaw zakres dat, kliknij Go, potem Download CSV. Plik: Orders.csv.</li>
        <li>Zakładka Cash History: te same daty i to samo konto, Go, Download CSV. Plik: Cash History.csv.</li>
        <li>Zostaw oba pliki w folderze Pobrane. Automat sam je znajdzie. Z telefonu albo innego komputera wgraj je ręcznie, najpierw Orders, potem Cash History.</li>
      </ol>
      <p className="text-meta text-muted">Orders daje ceny i czasy, Cash History daje prowizje. Wynik netto dziennik liczy z obu plików. Z telefonu eksportu nie zrobisz.</p>
    </div>
  );
}
