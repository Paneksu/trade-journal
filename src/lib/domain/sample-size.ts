/**
 * Wielkosc proby i niepewnosc wyniku.
 *
 * Kazda statystyka policzona z kilkunastu trade'ow jest zgadywaniem. Ten modul
 * pilnuje, zeby interfejs zawsze pokazywal, ile trade'ow stoi za liczba
 * i jak szeroki jest przedzial, w ktorym moze lezec prawdziwa oczekiwana wartosc.
 */

export type SampleStatus = "too_small" | "preliminary" | "full";

export type SampleAssessment = {
  count: number;
  target: number;
  percent: number;
  status: SampleStatus;
  message: string;
};

export function assessSample(count: number, target = 100, minSample = 15): SampleAssessment {
  const safeTarget = Math.max(1, target);
  const percent = Math.min(100, Math.round((count / safeTarget) * 100));

  let status: SampleStatus = "full";
  let message = `Próbka ${count} trade'ów. Wyniki można traktować poważnie.`;

  if (count < minSample) {
    status = "too_small";
    message = `Tylko ${count} z ${safeTarget} trade'ów. Poniżej ${minSample} statystyki nic nie znaczą.`;
  } else if (count < safeTarget) {
    status = "preliminary";
    message = `${count} z ${safeTarget} trade'ów. Kierunek już widać, ale liczby będą się jeszcze ruszać.`;
  }

  return { count, target: safeTarget, percent, status, message };
}

export type Interval = {
  low: number;
  high: number;
  margin: number;
};

/**
 * Przedzial ufnosci 95% dla oczekiwanej wartosci w R.
 * Wymaga co najmniej dwoch pomiarow - inaczej odchylenie nie istnieje.
 */
export function expectancyInterval(
  expectancyR: number | null,
  stdevR: number | null,
  count: number,
): Interval | null {
  if (expectancyR === null || stdevR === null || count < 2) return null;
  const margin = 1.96 * (stdevR / Math.sqrt(count));
  return { low: expectancyR - margin, high: expectancyR + margin, margin };
}

/**
 * Ile trade'ow trzeba, zeby przedzial ufnosci zwezil sie do zadanej szerokosci.
 * Odpowiada na pytanie "ile jeszcze musze zebrac, zeby to cos znaczylo".
 */
export function requiredSample(stdevR: number | null, targetMargin = 0.2): number | null {
  if (stdevR === null || stdevR <= 0 || targetMargin <= 0) return null;
  return Math.ceil(((1.96 * stdevR) / targetMargin) ** 2);
}
