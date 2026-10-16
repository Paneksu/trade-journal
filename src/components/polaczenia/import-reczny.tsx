"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { podgladImportuAkcja, zapiszImportAkcja, type PodgladState } from "@/lib/actions/broker";
import { cx } from "@/lib/classes";
import { money, pnlClass } from "@/lib/format";
import type { PozycjaImportu, SukcesImportu } from "@/lib/brokerzy/import";

import { czas, klasaPrzycisku, kwota, nazwaFormatu, POLE_KLASA, usePreferowaneKonto, Zywy, type KontoDziennika } from "./wspolne";

/*
 * Ręczny import pliku (ADR-034 pkt 2). Dwa kroki za sesją: PODGLĄD (suchy bieg, zero zapisów) i ZAPIS (przeglądarka wysyła
 * plik ponownie, serwer sprawdza SHA-256 z podglądu). Plik trzymamy w stanie Reacta, bo formularz po akcji się resetuje.
 * Dane z pliku (nazwy, ostrzeżenia, powody) renderujemy wyłącznie jako tekst.
 */

const LIMIT = 5 * 1024 * 1024;
const STREFY = [
  { v: "Europe/Warsaw", e: "Europe/Warsaw (Warszawa)" },
  { v: "America/New_York", e: "America/New_York (Nowy Jork)" },
  { v: "UTC", e: "UTC" },
  { v: "inna", e: "Inna (wpiszę nazwę IANA)" },
];

type Wejscie = { plik: File; strefa: string; pomin: boolean };

function klucz(w: Wejscie): string {
  return `${w.plik.name}|${w.plik.size}|${w.plik.lastModified}|${w.strefa}|${w.pomin}`;
}

function Statystyka({ etykieta, wartosc }: { etykieta: string; wartosc: number | string }) {
  return (
    <div>
      <dt className="text-meta text-muted">{etykieta}</dt>
      <dd className="num text-karta text-text">{wartosc}</dd>
    </div>
  );
}

export function ImportReczny({ konta, strefaDomyslna }: { konta: KontoDziennika[]; strefaDomyslna: string }) {
  const router = useRouter();
  const { preferowane } = usePreferowaneKonto();
  const [podglad, dispatchPodglad, trwaPodglad] = useActionState<PodgladState, FormData>(podgladImportuAkcja, {});
  const [zapis, dispatchZapis, trwaZapis] = useActionState<PodgladState, FormData>(zapiszImportAkcja, {});
  const wejscie = useRef<HTMLInputElement>(null);

  const [plik, setPlik] = useState<File | null>(null);
  const [wyborStrefy, setWyborStrefy] = useState(STREFY.some((s) => s.v === strefaDomyslna) ? strefaDomyslna : "Europe/Warsaw");
  const [innaStrefa, setInnaStrefa] = useState("");
  const [pomin, setPomin] = useState(false);
  const [bladLokalny, setBladLokalny] = useState<string | null>(null);
  const [przypisania, setPrzypisania] = useState<Record<string, number | null>>({});
  const [odznaczone, setOdznaczone] = useState<Set<string>>(new Set());
  const [utworz, setUtworz] = useState<Set<string>>(new Set());
  const [podgladDla, setPodgladDla] = useState<string | null>(null);
  const [zapisano, setZapisano] = useState(false);

  const strefa = wyborStrefy === "inna" ? innaStrefa.trim() : wyborStrefy;
  const biezacy = plik ? klucz({ plik, strefa, pomin }) : null;

  const zbuduj = (p: Record<string, number | null>, dolacz: Record<string, string>): FormData | null => {
    if (!plik) return null;
    const fd = new FormData();
    fd.set("plik", plik);
    fd.set("strefa", strefa);
    fd.set("pominBledne", pomin ? "1" : "0");
    fd.set("przypisania", JSON.stringify(p));
    for (const [k, v] of Object.entries(dolacz)) fd.set(k, v);
    return fd;
  };

  const uruchomPodglad = (p: Record<string, number | null>) => {
    setBladLokalny(null);
    if (!plik) return setBladLokalny("Wybierz plik CSV z eksportu (Orders albo Cash History z Tradovate).");
    if (plik.size > LIMIT) return setBladLokalny(`Plik ma ${(plik.size / 1048576).toFixed(1)} MB, a limit to 5 MB. Wyeksportuj krótszy zakres dat; plik nie został wysłany.`);
    if (wyborStrefy === "inna" && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(innaStrefa.trim())) return setBladLokalny("Wpisz nazwę strefy w formacie IANA, np. America/Chicago.");
    const fd = zbuduj(p, {});
    if (!fd) return;
    setZapisano(false);
    setPodgladDla(biezacy);
    startTransition(() => dispatchPodglad(fd));
  };

  const wynik = podglad.wynik;
  const sukces: SukcesImportu | null = wynik && wynik.ok ? wynik : null;
  const aktualny = podgladDla !== null && podgladDla === biezacy;
  const widoczne = new Set((sukces?.pozycje ?? []).map((p) => p.externalRef));

  const zapisz = () => {
    if (!sukces || sukces.status !== "applied") return;
    const fd = zbuduj(przypisania, {
      sha256: sukces.sha256,
      odznaczone: JSON.stringify([...odznaczone].filter((r) => widoczne.has(r))),
      utworz: JSON.stringify([...utworz].filter((r) => widoczne.has(r))),
    });
    if (!fd) return;
    setZapisano(true);
    startTransition(() => dispatchZapis(fd));
  };

  // po zapisie odświeżamy listy (raz, gdy zapis zwrócił sukces)
  const zapisanyWynik = zapisano && zapis.wynik && zapis.wynik.ok ? zapis.wynik : null;
  const idZapisu = zapisanyWynik?.importId ?? null;
  useEffect(() => {
    if (idZapisu !== null) router.refresh();
  }, [idZapisu, router]);

  const wolneKonta = konta.filter((k) => k.brokerAccountId === null);
  const przelacz = (zbior: Set<string>, ustaw: (s: Set<string>) => void, ref: string, wlacz: boolean) => {
    const n = new Set(zbior);
    if (wlacz) n.add(ref);
    else n.delete(ref);
    ustaw(n);
  };

  const zmienPrzypisanie = (hmac: string, v: string) => {
    const nowe = { ...przypisania, [hmac]: v === "" ? null : Number(v) };
    setPrzypisania(nowe);
    uruchomPodglad(nowe); // przypisanie zmienia dopasowania, więc podgląd liczymy od nowa
  };

  return (
    <div className="space-y-4" id="import-reczny-formularz">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          uruchomPodglad(przypisania);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="broker-plik" className="block text-meta text-muted">
              Plik CSV z eksportu <span className="text-faint">· najpierw Orders, potem Cash History</span>
            </label>
            <input
              ref={wejscie}
              id="broker-plik"
              data-testid="broker-plik"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setPlik(e.target.files?.[0] ?? null);
                setBladLokalny(null);
                setZapisano(false);
              }}
              className="block w-full text-karta text-muted file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-surface-3 file:px-3.5 file:text-karta file:text-text sm:file:min-h-8"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="broker-strefa" className="block text-meta text-muted">
              Strefa czasowa czasów w pliku <span className="text-faint">· plik jej nie podaje</span>
            </label>
            <select id="broker-strefa" data-testid="broker-strefa" value={wyborStrefy} onChange={(e) => setWyborStrefy(e.target.value)} className={cx(POLE_KLASA, "cursor-pointer")}>
              {STREFY.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.e}
                </option>
              ))}
            </select>
          </div>
          {wyborStrefy === "inna" && (
            <div className="space-y-1.5">
              <label htmlFor="broker-strefa-inna" className="block text-meta text-muted">
                Nazwa strefy IANA
              </label>
              <input id="broker-strefa-inna" data-testid="broker-strefa-inna" value={innaStrefa} onChange={(e) => setInnaStrefa(e.target.value)} placeholder="America/Chicago" autoComplete="off" className={POLE_KLASA} />
            </div>
          )}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-karta text-text sm:min-h-0">
          <input type="checkbox" data-testid="broker-pomin-bledne" checked={pomin} onChange={(e) => setPomin(e.target.checked)} className="size-4 accent-accent" />
          Pomiń błędne wiersze
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" data-testid="broker-podglad" className={klasaPrzycisku(true)} disabled={trwaPodglad || trwaZapis}>
            {trwaPodglad ? "Liczę podgląd…" : "Pokaż podgląd"}
          </button>
          <span className="text-meta text-muted">Podgląd niczego nie zapisuje.</span>
        </div>
      </form>

      <Zywy blad={Boolean(bladLokalny || podglad.error)}>{bladLokalny ?? podglad.error}</Zywy>

      {wynik && !wynik.ok && aktualny && (
        <div role="alert" className="space-y-2 rounded-[var(--radius-tab)] border border-loss/50 p-4" data-testid="broker-podglad-blad">
          <p className="text-karta text-loss">{wynik.komunikat}</p>
          {wynik.kod === "rows_invalid" && <p className="text-meta text-muted">Zaznacz „Pomiń błędne wiersze”, jeśli chcesz zaimportować resztę pliku, i pokaż podgląd jeszcze raz.</p>}
          {wynik.bledy && wynik.bledy.length > 0 && (
            <ul className="num max-h-48 overflow-y-auto text-meta text-muted">
              {wynik.bledy.slice(0, 50).map((b) => (
                <li key={b.numerWiersza}>
                  Wiersz {b.numerWiersza}: {b.powod}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sukces && !aktualny && <p className="text-meta text-muted" data-testid="broker-podglad-nieaktualny">Zmieniono plik albo ustawienia po ostatnim podglądzie. Pokaż podgląd jeszcze raz.</p>}

      {sukces && aktualny && sukces.status === "duplicate" && (
        <div role="status" className="rounded-[var(--radius-tab)] border border-line-strong p-4 text-karta text-text" data-testid="broker-duplikat">
          Ten plik zaimportowano {czas(sukces.zaimportowanoWczesniej)}. Nic się nie zdubluje, więc nie ma czego zapisywać.{" "}
          <Link href="#importy" className="underline underline-offset-2">
            Zobacz historię importów
          </Link>
          .
        </div>
      )}

      {sukces && aktualny && sukces.status === "applied" && !zapisanyWynik && (
        <section aria-label="Podgląd importu" className="space-y-4 rounded-[var(--radius-panel)] border border-line-strong p-4" data-testid="broker-podglad-wynik">
          <p className="text-karta text-text">
            Format: <span className="text-text">{nazwaFormatu(sukces.format)}</span> <span className="text-muted">· strefa {sukces.strefa}</span>
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Statystyka etykieta="Nowe wypełnienia" wartosc={sukces.wypelnienia.nowe} />
            <Statystyka etykieta="Duplikaty" wartosc={sukces.wypelnienia.duplikaty} />
            <Statystyka etykieta="Zdarzenia z opłatami" wartosc={sukces.zdarzenia.nowe} />
            <Statystyka etykieta="Wiersze pominięte" wartosc={sukces.wiersze.pominiete + sukces.wiersze.bledne} />
            <Statystyka etykieta="Do uzgodnienia" wartosc={sukces.trade.dopasowane} />
            <Statystyka etykieta="Do decyzji" wartosc={sukces.trade.doDecyzji} />
            <Statystyka etykieta="Pozycje otwarte" wartosc={sukces.trade.otwarte} />
          </dl>

          {sukces.konta.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-karta text-text">Konta w pliku</h3>
              <ul className="space-y-2">
                {sukces.konta.map((k) => {
                  const wybrane = k.hmac in przypisania ? przypisania[k.hmac] : k.kontoDziennikaId;
                  const potrzebuje = k.kontoDziennikaId === null;
                  const idSelect = `broker-konto-${k.hmac.slice(0, 8)}`;
                  const podp = potrzebuje && !(k.hmac in przypisania) && preferowane !== null && wolneKonta.some((c) => c.id === preferowane) ? preferowane : null;
                  return (
                    <li key={k.hmac} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="num text-karta text-text">…{k.ostatnie4}</span>
                      <span className="text-meta text-muted">{k.nowe ? "nowe konto u brokera" : "znane konto u brokera"}</span>
                      {potrzebuje ? (
                        <>
                          <label htmlFor={idSelect} className="sr-only">
                            Konto dziennika dla …{k.ostatnie4}
                          </label>
                          <select id={idSelect} data-testid={`broker-przypisz-${k.hmac.slice(0, 8)}`} value={wybrane ?? ""} onChange={(e) => zmienPrzypisanie(k.hmac, e.target.value)} className={cx(POLE_KLASA, "w-auto min-w-48 cursor-pointer")}>
                            <option value="">Zostaw nieprzypisane</option>
                            {wolneKonta.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          {podp !== null && <button type="button" className={klasaPrzycisku(false)} onClick={() => zmienPrzypisanie(k.hmac, String(podp))}>Użyj konta z kreatora</button>}
                        </>
                      ) : (
                        <span className="text-meta text-muted">przypisane do konta dziennika #{k.kontoDziennikaId}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-meta text-muted">Bez przypisanego konta dziennika trade&apos;y nie zostaną dopasowane ani utworzone. Przypiszesz je później w sekcji „Konta u brokera”.</p>
            </div>
          )}

          {sukces.ostrzezenia.length > 0 && (
            <div className="space-y-1.5" data-testid="broker-ostrzezenia">
              <h3 className="text-karta text-text">Ostrzeżenia</h3>
              <ul className="space-y-1.5 text-meta text-muted">
                {sukces.ostrzezenia.map((o, i) => (
                  <li key={`${o.code}-${i}`} className="rounded-[var(--radius-tab)] border border-line-strong px-3 py-2">
                    {o.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sukces.bledy.length > 0 && (
            <div className="space-y-1.5" data-testid="broker-bledne-wiersze">
              <h3 className="text-karta text-text">Błędne wiersze (pominięte po zaznaczeniu „Pomiń błędne wiersze”)</h3>
              <ul className="num max-h-48 overflow-y-auto text-meta text-muted">
                {sukces.bledy.slice(0, 50).map((b) => (
                  <li key={b.numerWiersza}>
                    Wiersz {b.numerWiersza}: {b.powod}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Pozycje
            pozycje={sukces.pozycje}
            strefa={strefaDomyslna}
            odznaczone={odznaczone}
            utworz={utworz}
            naUzgodnij={(ref, zazn) => przelacz(odznaczone, setOdznaczone, ref, !zazn)}
            naUtworz={(ref, zazn) => przelacz(utworz, setUtworz, ref, zazn)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="broker-zapisz-import" className={klasaPrzycisku(true)} disabled={trwaZapis || trwaPodglad} onClick={zapisz}>
              {trwaZapis ? "Zapisuję…" : "Zapisz import"}
            </button>
            <span className="text-meta text-muted">Zapis dzieje się w jednej transakcji i da się go cofnąć w historii importów.</span>
          </div>
        </section>
      )}

      <Zywy blad={Boolean(zapis.error)}>{zapis.error}</Zywy>
      {zapis.wynik && !zapis.wynik.ok && zapisano && (
        <div role="alert" className="rounded-[var(--radius-tab)] border border-loss/50 p-4 text-karta text-loss" data-testid="broker-zapis-blad">
          {zapis.wynik.komunikat}
        </div>
      )}
      {zapisanyWynik && (
        <div role="status" className="space-y-2 rounded-[var(--radius-panel)] border border-line-strong p-4" data-testid="broker-zapis-wynik">
          <p className="text-karta text-text">
            Zapisano import <span className="num">#{zapisanyWynik.importId}</span>
            {zapisanyWynik.status === "duplicate" ? " (ten plik był już zaimportowany, nic się nie zmieniło)" : ""}: {zapisanyWynik.trade.dopasowane} uzgodnionych, {zapisanyWynik.trade.utworzone} utworzonych, {zapisanyWynik.trade.doDecyzji} do decyzji.
          </p>
          {zapisanyWynik.zastosowane.length > 0 && (
            <ul className="num flex flex-wrap gap-x-4 text-meta text-muted">
              {zapisanyWynik.zastosowane.map((z) => (
                <li key={z.brokerTradeId}>
                  <Link href={`/trades/${z.tradeId}`} className="underline underline-offset-2 hover:text-text">
                    trade #{z.tradeId}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta text-muted">
            <Link href="#uzgodnione" className="underline underline-offset-2 hover:text-text">Uzgodnione z rachunku</Link>
            {" · "}
            <Link href="#do-decyzji" className="underline underline-offset-2 hover:text-text">Do decyzji</Link>
            {" · "}
            <Link href="#importy" className="underline underline-offset-2 hover:text-text">Historia importów</Link>
          </p>
          <button
            type="button"
            className={klasaPrzycisku(false)}
            onClick={() => {
              setPlik(null);
              setPodgladDla(null);
              setZapisano(false);
              setOdznaczone(new Set());
              setUtworz(new Set());
              setPrzypisania({});
              if (wejscie.current) wejscie.current.value = "";
            }}
          >
            Wgraj kolejny plik
          </button>
        </div>
      )}
    </div>
  );
}

function Pozycje({
  pozycje,
  strefa,
  odznaczone,
  utworz,
  naUzgodnij,
  naUtworz,
}: {
  pozycje: PozycjaImportu[];
  strefa: string;
  odznaczone: Set<string>;
  utworz: Set<string>;
  naUzgodnij: (ref: string, zaznaczone: boolean) => void;
  naUtworz: (ref: string, zaznaczone: boolean) => void;
}) {
  if (pozycje.length === 0) {
    return <p className="text-meta text-muted">Ten plik nie zmienił żadnego trade&apos;a brokera (np. sam Cash History bez nowych zleceń).</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="text-karta text-text">Trade&apos;y brokera ({pozycje.length})</h3>
      <ul className="space-y-3">
        {pozycje.map((p) => {
          const uzgodnienie = p.stanDopasowania === "matched" && p.tradeId !== null && p.nowy && p.pnlPo !== null;
          const mozeUtworzyc = p.status === "closed" && p.tradeId === null && p.stanDopasowania === "unmatched" && p.kontoDziennikaId !== null;
          return (
            <li key={p.externalRef} className="rounded-[var(--radius-tab)] border border-line-strong p-3" data-testid={`broker-pozycja-${p.externalRef}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-karta text-text">
                  <span className="num">{p.kontrakt}</span> {p.kierunek} <span className="num">{p.ilosc}</span>
                  {p.kontoOstatnie4 && <span className="num text-muted"> · …{p.kontoOstatnie4}</span>}
                </p>
                <p className="num text-karta">
                  <span className="sr-only">netto </span>
                  <span className={pnlClass(p.nettoCenty)}>{kwota(p.nettoCenty)}</span>
                </p>
              </div>
              <p className="num text-meta text-muted">
                {czas(p.wejscie, strefa)} → {p.wyjscie ? czas(p.wyjscie, strefa) : "otwarta"} · {p.cenaWejscia}
                {p.cenaWyjscia !== null ? ` → ${p.cenaWyjscia}` : ""}
              </p>
              <p className="num text-meta text-muted">
                brutto {p.bruttoCenty === null ? "brak" : money(p.bruttoCenty, { sign: true })} · opłaty {p.oplatyCenty === null ? "brak" : money(p.oplatyCenty)}{" "}
                <span className="font-sans">{p.zrodloOplat === "broker" ? "(opłaty z pliku)" : p.zrodloOplat === "rate" ? "(opłaty wg stawki)" : "(opłaty nieznane)"}</span>
              </p>

              {p.status === "open" && <p className="mt-2 text-meta text-muted">Pozycja otwarta. Domknie ją kolejny import.</p>}

              {uzgodnienie && (
                <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 text-karta text-text sm:min-h-0">
                  <input
                    type="checkbox"
                    data-testid={`broker-odznacz-${p.externalRef}`}
                    checked={!odznaczone.has(p.externalRef)}
                    onChange={(e) => naUzgodnij(p.externalRef, e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span>
                    Uzgodnij z trade&apos;em <span className="num">#{p.tradeId}</span> (było{" "}
                    <span className={cx("num", pnlClass(p.pnlPrzed))}>{kwota(p.pnlPrzed)}</span> → jest <span className={cx("num", pnlClass(p.pnlPo))}>{kwota(p.pnlPo)}</span>)
                  </span>
                </label>
              )}
              {p.stanDopasowania === "matched" && !uzgodnienie && p.tradeId !== null && (
                <p className="mt-2 text-meta text-muted">Dopasowane wcześniej do trade&apos;a <span className="num">#{p.tradeId}</span>.</p>
              )}
              {p.stanDopasowania === "ambiguous" && (
                <p className="mt-2 text-meta text-muted">
                  Niejednoznaczne{p.powod ? `: ${p.powod}` : ""}
                  {p.kandydaci.length > 0 && <> (kandydaci: {p.kandydaci.map((k) => `#${k}`).join(", ")})</>}. Nie zaznaczam nic. Rozstrzygniesz w sekcji „Do decyzji”.
                </p>
              )}
              {p.stanDopasowania === "unmatched" && p.status === "closed" && (
                <>
                  <p className="mt-2 text-meta text-muted">Bez odpowiednika w dzienniku{p.powod ? `: ${p.powod}` : ""}.</p>
                  {mozeUtworzyc ? (
                    <label className="mt-1 flex min-h-11 cursor-pointer items-start gap-2 text-karta text-text sm:min-h-0">
                      <input
                        type="checkbox"
                        data-testid={`broker-utworz-${p.externalRef}`}
                        checked={utworz.has(p.externalRef)}
                        onChange={(e) => naUtworz(p.externalRef, e.target.checked)}
                        className="mt-0.5 size-4 shrink-0 accent-accent"
                      />
                      <span>Utwórz trade w dzienniku z danych rachunku</span>
                    </label>
                  ) : (
                    <p className="text-meta text-muted">Przypisz konto dziennika do konta u brokera, żeby dopasować albo utworzyć trade.</p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
