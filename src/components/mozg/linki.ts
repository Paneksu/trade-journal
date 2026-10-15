/**
 * `[[Tytuł]]` w treści notatki -> link markdown do notatki (po tytule, bez wielkości liter i ogonków, jak indeks
 * `notes_title_norm_idx`). Link do nieistniejącej notatki zostaje widoczny jako tekst z dopiskiem: API pozwala
 * na takie linki i dowiązuje je, gdy notatka powstanie.
 */

export function normalizujTytul(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase().trim();
}

export function linkiNaMarkdown(tresc: string, tytuly: { id: number; title: string }[]): string {
  const mapa = new Map(tytuly.map((t) => [normalizujTytul(t.title), t.id]));
  return tresc.replace(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g, (_c, tytul: string) => {
    const id = mapa.get(normalizujTytul(tytul));
    const tekst = tytul.replace(/[[\]]/g, "");
    return id ? `[${tekst}](/mozg/notatki/${id})` : `*${tekst}* (brak notatki)`;
  });
}
