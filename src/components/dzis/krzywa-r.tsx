import { shortDate } from "@/lib/format";
import type { DzienWykresu } from "@/lib/queries/dzis";

/**
 * Krzywa skumulowanego R z 30 dni (wzór: wykres salda w karcie głównej Mercury, wypełnienie pod linią
 * do krawędzi karty, 5 dat pod spodem). Statyczne SVG, bez JS: liczba nad wykresem niesie informację,
 * a wykres kształt. Barwa stalowa (viz-8), bo akcent jest zarezerwowany dla akcji i stanu aktywnego,
 * a zieleń/czerwień dla wyniku pojedynczego trade'a.
 */
export function KrzywaR({ punkty }: { punkty: DzienWykresu[] }) {
  const W = 472;
  const H = 150;
  if (punkty.length < 2) {
    return (
      <div className="flex h-[150px] items-center justify-center border-t border-line text-meta text-faint">
        Za mało zamkniętych dni w ostatnich 30, żeby narysować krzywą.
      </div>
    );
  }
  const wartosci = [0, ...punkty.map((p) => p.suma)];
  const min = Math.min(...wartosci);
  const max = Math.max(...wartosci);
  const zakres = max - min || 1;
  const x = (i: number) => (i / (wartosci.length - 1)) * W;
  const y = (v: number) => 12 + (1 - (v - min) / zakres) * (H - 24);
  // Krzywa wygładzona (Catmull-Rom -> Bezier), jak miękka linia salda we wzorze.
  const pkt = wartosci.map((v, i) => [x(i), y(v)] as const);
  const linia = pkt
    .map(([px, py], i) => {
      if (i === 0) return `M${px.toFixed(1)},${py.toFixed(1)}`;
      const [x0, y0] = pkt[Math.max(0, i - 2)];
      const [x1, y1] = pkt[i - 1];
      const [x3, y3] = pkt[Math.min(pkt.length - 1, i + 1)];
      const c1x = x1 + (px - x0) / 6;
      const c1y = y1 + (py - y0) / 6;
      const c2x = px - (x3 - x1) / 6;
      const c2y = py - (y3 - y1) / 6;
      return `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  const pole = `${linia} L${W},${H} L0,${H} Z`;
  const zero = y(0);
  const etykiety = [0, 0.25, 0.5, 0.75, 1].map((f) => punkty[Math.round(f * (punkty.length - 1))]);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[150px] w-full" role="img" aria-label={`Skumulowane R z ${punkty.length} dni handlowych`}>
        <defs>
          <linearGradient id="krzywa-r-wypelnienie" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-viz-8)" stopOpacity="0.24" />
            <stop offset="1" stopColor="var(--color-viz-8)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--color-line-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <path d={pole} fill="url(#krzywa-r-wypelnienie)" />
        <path d={linia} fill="none" stroke="var(--color-viz-8)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between border-t border-line px-5 pt-2.5 pb-3 text-meta text-muted sm:px-6">
        {etykiety.map((p, i) => (
          <span key={`${p.dzien}-${i}`} className="num">
            {shortDate(p.dzien)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
