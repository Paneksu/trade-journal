"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import { Button, Input, Label, Select } from "@/components/ui/base";
import { cx } from "@/lib/classes";
import { INTERWALY, WARSTWA_NAZWY, WARSTWY } from "@/lib/domain/interwaly";
import { POWODY, POWOD_NAZWY } from "@/lib/domain/kierunek";
import type { FieldDef } from "@/lib/fields/fields";
import { GROUPABLE_TYPES } from "@/lib/fields/fields";
import type { Account, Instrument } from "@/lib/db/schema";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Pasek filtrow. Kazdy filtr to parametr adresu, wiec kazdy stan tabeli
 * da sie wysłać linkiem i zapisac jako widok.
 */
export function FilterBar({
  accounts,
  instruments,
  tags,
  fields,
  activeCount,
  embedded = false,
  domyslnieOtwarty = true,
}: {
  accounts: Account[];
  instruments: Instrument[];
  tags: TagWithCategory[];
  fields: FieldDef[];
  activeCount: number;
  /** Gdy pasek jest czescia wiekszego panelu, nie rysuje wlasnej ramki. */
  embedded?: boolean;
  /** Galeria wlacza `withShots` sama, z rozpedu - to nie jest filtr, ktory
   *  uzytkownik swiadomie ustawil, wiec nie powinien rozwijac panelu przy
   *  wejsciu (recenzja 2026-08-30, znalezisko 2). `/trades` i `/stats` nie
   *  przekazuja tego propa i zachowuja stare zachowanie. */
  domyslnieOtwarty?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(domyslnieOtwarty && activeCount > 0);

  const value = (key: string) => params.get(key) ?? "";
  const values = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);

  const filterFields = fields.filter((f) => !f.archived && GROUPABLE_TYPES.includes(f.type));

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const next = new URLSearchParams();

    for (const [key, raw] of data.entries()) {
      const w = String(raw).trim();
      if (w === "") continue;
      const previous = next.get(key);
      next.set(key, previous ? `${previous},${w}` : w);
    }

    // Parametry spoza formularza (jednostka, zrodlo) maja przetrwac filtrowanie.
    for (const key of ["jednostka", "zrodlo", "sesja"]) {
      const w = params.get(key);
      if (w) next.set(key, w);
    }

    const query = next.toString();
    router.push(query ? `?${query}` : "?");
  }

  return (
    <div className={embedded ? "" : "panel"}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((w) => !w)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-text"
        >
          <Filter size={14} aria-hidden />
          Filtry
          {activeCount > 0 && (
            <span className="rounded-full bg-accent-dim px-1.5 text-xs text-accent">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => router.push("?")}
            className="inline-flex items-center gap-1 text-xs text-faint transition-colors duration-150 hover:text-text"
          >
            <X size={12} aria-hidden />
            wyczyść wszystkie
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className={cx("border-t border-line", open ? "block" : "hidden")}
      >
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="od">Od dnia</Label>
            <Input id="od" name="od" type="date" defaultValue={value("od")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="do">Do dnia</Label>
            <Input id="do" name="do" type="date" defaultValue={value("do")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="konto">Konto</Label>
            <Select id="konto" name="konto" defaultValue={value("konto")}>
              <option value="">wszystkie</option>
              {accounts.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="instrument">Instrument</Label>
            <Select id="instrument" name="instrument" defaultValue={value("instrument")}>
              <option value="">wszystkie</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol}
                </option>
              ))}
            </Select>
          </div>

          {/* Filtr strategii zniknal 2026-08-29 razem z polem w formularzu.
              Parametr "strategia" zostaje obslugiwany w queries/filters.ts,
              zeby stare zapisane widoki i linki nie przestaly dzialac. */}

          <div className="space-y-1.5">
            <Label htmlFor="kierunek">Kierunek</Label>
            <Select id="kierunek" name="kierunek" defaultValue={value("kierunek")}>
              <option value="">oba</option>
              <option value="long">long</option>
              <option value="short">short</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wynik">Wynik</Label>
            <Select id="wynik" name="wynik" defaultValue={value("wynik")}>
              <option value="">wszystkie</option>
              <option value="zysk">zyskowne</option>
              <option value="strata">stratne</option>
              <option value="be">na zero (BE)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="interwal">Interwał</Label>
            <Select id="interwal" name="interwal" defaultValue={value("interwal")}>
              <option value="">wszystkie</option>
              {INTERWALY.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="warstwa">Warstwa TF</Label>
            <Select id="warstwa" name="warstwa" defaultValue={value("warstwa")}>
              <option value="">wszystkie</option>
              {WARSTWY.map((w) => (
                <option key={w} value={w}>
                  {WARSTWA_NAZWY[w]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kierunek_ok">Trafność kierunku</Label>
            <Select id="kierunek_ok" name="kierunek_ok" defaultValue={value("kierunek_ok")}>
              <option value="">wszystkie</option>
              <option value="tak">kierunek trafiony</option>
              <option value="nie">kierunek chybiony</option>
              <option value="nieocenione">nieocenione</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="powod">Powód złej egzekucji</Label>
            <Select id="powod" name="powod" defaultValue={value("powod")}>
              <option value="">wszystkie</option>
              {POWODY.map((w) => (
                <option key={w} value={w}>
                  {POWOD_NAZWY[w]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zezrzutem">Zrzuty</Label>
            {/* "wszystko" jest wartoscia JAWNA, nie pustym stringiem: w galerii
                brak parametru znaczy "tylko ze zrzutem", wiec pusta opcja nie
                mialaby jak wylaczyc tego filtru. */}
            <Select id="zezrzutem" name="zezrzutem" defaultValue={value("zezrzutem")}>
              <option value="wszystko">wszystkie</option>
              <option value="1">tylko ze zrzutem</option>
              <option value="0">tylko bez zrzutu</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pominiete">Nie wzięte</Label>
            <Select id="pominiete" name="pominiete" defaultValue={value("pominiete")}>
              <option value="">wszystkie</option>
              <option value="nie">pomiń</option>
              <option value="tylko">tylko te</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rynek">Sesja rynkowa</Label>
            <Select id="rynek" name="rynek" defaultValue={value("rynek")}>
              <option value="">wszystkie</option>
              <option value="rth">sesja główna</option>
              <option value="premarket">przed sesją</option>
              <option value="afterhours">po sesji</option>
              <option value="overnight">noc</option>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="szukaj">Szukaj w notatkach</Label>
            <Input
              id="szukaj"
              name="szukaj"
              type="search"
              defaultValue={value("szukaj")}
              placeholder="fragment notatki albo wartości pola"
            />
          </div>

          {filterFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`pole_${f.key}`}>{f.label}</Label>
              {f.type === "bool" ? (
                <Select
                  id={`pole_${f.key}`}
                  name={`pole_${f.key}`}
                  defaultValue={value(`pole_${f.key}`)}
                >
                  <option value="">wszystkie</option>
                  <option value="true">tak</option>
                  <option value="false">nie</option>
                </Select>
              ) : f.type === "rating" ? (
                <Select
                  id={`pole_${f.key}`}
                  name={`pole_${f.key}`}
                  defaultValue={value(`pole_${f.key}`)}
                >
                  <option value="">wszystkie</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}/5
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  id={`pole_${f.key}`}
                  name={`pole_${f.key}`}
                  defaultValue={value(`pole_${f.key}`)}
                >
                  <option value="">wszystkie</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          ))}
        </div>

        <div className="px-3 pb-3">
          <Label>Tagi</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tags
              .filter((t) => !t.archived)
              .map((t) => (
                <label key={t.id} className="cursor-pointer">
                  <input
                    type="checkbox"
                    name="tag"
                    value={t.id}
                    defaultChecked={values("tag").includes(String(t.id))}
                    className="peer sr-only"
                  />
                  <span
                    className={cx(
                      "inline-flex items-center rounded-[var(--radius-control)] border",
                      "border-line-strong bg-surface-2 px-2 py-1 text-xs text-muted",
                      "transition-colors duration-150 hover:border-faint",
                      "peer-checked:border-accent peer-checked:text-text",
                      "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
                    )}
                  >
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                      aria-hidden
                    />
                    {t.name}
                  </span>
                </label>
              ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <Button type="submit" variant="primary" size="s">
            Zastosuj
          </Button>
          <span className="text-xs text-faint">
            Filtry siedzą w adresie — możesz zapisać go w zakładkach.
          </span>
        </div>
      </form>
    </div>
  );
}
