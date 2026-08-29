"use client";

import { cx } from "@/lib/classes";
import { interwalyWarstwy, WARSTWY, type Warstwa } from "@/lib/domain/interwaly";
import type { TagWithCategory } from "@/lib/queries/dictionaries";

/**
 * Wybor tagow pogrupowany kategoriami. Zwykle checkboxy - dziala bez
 * JavaScriptu i obsluguje sie klawiatura tak samo jak reszta formularza.
 *
 * Interwal jest atrybutem przypisania, nie tagu (ADR-013), a od ADR-017 jeden
 * tag moze miec ich KILKA naraz: ta sama konfluencja bywa widoczna i na 4h,
 * i na 5m, i dopiero ta para jest informacja. Stad zamiast jednego `<select>`
 * jest wiersz checkboxow `tagint:<id>`, rozdzielony na HTF i LTF - podzial na
 * warstwy wynika z interwalu, wiec pokazujemy go wprost, zamiast zostawiac
 * jako ukryta regule.
 *
 * Kontrolki interwalu dostaja WYLACZNIE konfluencje. Nazwa setupu i blad
 * opisuja caly trade, nie warstwe - dawanie im skali czasu byloby zaproszeniem
 * do wpisywania danych, ktorych potem nie da sie sensownie zliczyc.
 *
 * Widocznosc robi czysty CSS: `peer-checked:` na PoZNIEJSZYM rodzenstwie tego
 * samego rodzica, wiec kolejnosc w DOM (input.peer -> label -> wiersz warstw)
 * jest wymuszona, nie kosmetyczna. Chip jest teraz `<label for>`, a nie
 * opakowaniem - dzieki temu zagniezdzone checkboxy interwalu nie przelaczaja
 * tagu i nie potrzeba do tego `stopPropagation`, czyli JavaScriptu.
 *
 * UWAGA: checkbox ukryty CSS-em nadal jedzie w FormData (`display:none` nie
 * wylacza kontrolki, robi to tylko `disabled`). Parser po stronie serwera musi
 * wiec iterowac po ZAZNACZONYCH TAGACH, nie po kluczach `tagint:*` - inaczej
 * odznaczenie tagu zostawiloby osierocone interwaly.
 */

const CHIP = [
  "inline-flex cursor-pointer items-center rounded-[var(--radius-control)] border",
  "border-line-strong bg-surface-2 px-2 py-1 text-xs text-muted",
  "transition-colors duration-150 hover:border-faint",
].join(" ");

const CHIP_MALY = [
  "inline-flex cursor-pointer items-center rounded-[var(--radius-control)] border",
  "border-line bg-surface px-1.5 py-0.5 text-[11px] text-faint",
  "transition-colors duration-150 hover:border-faint",
].join(" ");

export function TagPicker({
  tags,
  selected,
  name = "tag",
}: {
  tags: TagWithCategory[];
  /** Lista przypisan - ten sam `id` moze wystapic wiele razy, po razie na interwal. */
  selected: { id: number; interval: string | null }[];
  name?: string;
}) {
  const selectedIds = new Set(selected.map((s) => s.id));
  const active = tags.filter((t) => !t.archived || selectedIds.has(t.id));
  if (active.length === 0) {
    return (
      <p className="text-xs text-faint">
        Nie masz jeszcze żadnych tagów. Dodaj je poniżej albo w ustawieniach.
      </p>
    );
  }

  // Interwaly wybrane dla kazdego tagu. Mapa, nie `find`, bo przypisan tego
  // samego tagu bywa kilka i pierwsze z brzegu nic by nie znaczylo.
  const interwaly = new Map<number, Set<string>>();
  for (const s of selected) {
    if (s.interval === null) continue;
    const zbior = interwaly.get(s.id) ?? new Set<string>();
    zbior.add(s.interval);
    interwaly.set(s.id, zbior);
  }

  const categories = [...new Set(active.map((t) => t.category))];

  return (
    <div className="space-y-3">
      {categories.map((category) => (
        <div key={category}>
          <p className="etykieta mb-1.5">{category}</p>
          {/* Kazdy tag w osobnej linii (decyzja uzytkownika, 2026-08-29). Przy
              zawijanym rzedzie chipy konfluencji rozjezdzaly sie z wierszem
              interwalow, ktory rozwija sie obok zaznaczonego tagu - w kolumnie
              kazde zaznaczenie rosnie w dol, a nie przestawia sasiadow.
              `items-start`, bo chip ma miec szerokosc swojej nazwy, nie calego
              kontenera. */}
          <div className="flex flex-col items-start gap-1.5">
            {active
              .filter((t) => t.category === category)
              .map((t) => (
                <TagChip
                  key={t.id}
                  tag={t}
                  name={name}
                  zaznaczony={selectedIds.has(t.id)}
                  wybraneInterwaly={interwaly.get(t.id) ?? new Set()}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TagChip({
  tag,
  name,
  zaznaczony,
  wybraneInterwaly,
}: {
  tag: TagWithCategory;
  name: string;
  zaznaczony: boolean;
  wybraneInterwaly: Set<string>;
}) {
  const zInterwalami = tag.categoryKey === "confluence";
  const idPola = `tag-${tag.id}`;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        id={idPola}
        type="checkbox"
        name={name}
        value={tag.id}
        defaultChecked={zaznaczony}
        className="peer sr-only"
      />
      <label
        htmlFor={idPola}
        className={cx(
          CHIP,
          "peer-checked:border-accent peer-checked:bg-surface-3 peer-checked:text-text",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
        )}
      >
        <span
          className="mr-1.5 inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: tag.color }}
          aria-hidden
        />
        {tag.name}
      </label>

      {zInterwalami ? (
        <span
          className="hidden flex-wrap items-center gap-1 peer-checked:flex"
          role="group"
          aria-label={`Interwały dla konfluencji ${tag.name}`}
        >
          {WARSTWY.map((warstwa) => (
            <WierszWarstwy
              key={warstwa}
              warstwa={warstwa}
              tag={tag}
              wybraneInterwaly={wybraneInterwaly}
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function WierszWarstwy({
  warstwa,
  tag,
  wybraneInterwaly,
}: {
  warstwa: Warstwa;
  tag: TagWithCategory;
  wybraneInterwaly: Set<string>;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 border-l border-line pl-1.5">
      <span className="text-[10px] tracking-wide text-faint">{warstwa}</span>
      {interwalyWarstwy(warstwa).map((w) => {
        const idPola = `tagint-${tag.id}-${w}`;
        return (
          <span key={w} className="inline-flex">
            <input
              id={idPola}
              type="checkbox"
              name={`tagint:${tag.id}`}
              value={w}
              defaultChecked={wybraneInterwaly.has(w)}
              className="peer sr-only"
            />
            <label
              htmlFor={idPola}
              className={cx(
                CHIP_MALY,
                "peer-checked:border-accent peer-checked:bg-surface-3 peer-checked:text-text",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
              )}
            >
              {w}
            </label>
          </span>
        );
      })}
    </span>
  );
}
