import { useId } from "react";

/**
 * Znak dziennika: FVG, wariant V1 "Bycza luka z CE" (Slowa uzytkownika 14.10.2026: «V1: Bycza luka z CE»).
 * Zrodlo: docs/design/znak/runda-4-fvg/v1-bycza-ce/glif.svg (bez tla, do naglowka). Kolory sa czescia
 * znaku, nie tokenami interfejsu: metal swiec i zloto strefy FVG z generatora znaku.
 */
export function Znak({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const gradient = `znak-zloto-${id}`;
  return (
    <svg
      viewBox="2 1.5 29 29"
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c98a35" />
          <stop offset=".45" stopColor="#fcd593" />
          <stop offset="1" stopColor="#c47f2c" />
        </linearGradient>
      </defs>
      <rect x="4" y="13" width="25" height="5" fill="#e8a44c" fillOpacity=".42" />
      <rect x="4" y="12.5" width="25" height="1" fill="#e8a44c" />
      <rect x="4" y="17.5" width="25" height="1" fill="#e8a44c" />
      <rect x="7" y="18" width="1.6" height="11" rx=".8" fill="#8c99a7" />
      <rect x="5" y="20" width="5.6" height="6.5" rx="1" fill="#a9b4bf" />
      <rect x="24.4" y="3" width="1.6" height="10" rx=".8" fill="#8c99a7" />
      <rect x="22.4" y="5" width="5.6" height="6.5" rx="1" fill="#a9b4bf" />
      <rect x="15.2" y="2.5" width="1.6" height="27" rx=".8" fill={`url(#${gradient})`} />
      <rect x="12.6" y="5" width="6.8" height="22.5" rx="1.2" fill={`url(#${gradient})`} />
    </svg>
  );
}
