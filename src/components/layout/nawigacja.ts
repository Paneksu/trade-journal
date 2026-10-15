import {
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  ClipboardCheck,
  FlaskConical,
  Inbox,
  ListOrdered,
  Settings,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Nawigacja UI v2 wg planu fazy 5 („Nawigacja”): Dziś, Trade'y, Playbook, Przegląd, Backtest, Prop,
 * Mózg, Statystyki, Kalendarz, Ustawienia + licznik „Do decyzji”. Grupy jak we wzorze (Mercury:
 * pozycje główne, potem grupy z etykietą).
 *
 * `href: null` = ekran jeszcze nie zbudowany (kolejne etapy fazy 5). Pozycja jest widoczna, żeby
 * układ nawigacji był od razu docelowy, ale nie udaje linku (decyzja gustu, raport 15.10.2026).
 */

export type PozycjaNawigacji = {
  label: string;
  href: string | null;
  icon: LucideIcon;
  /** Pozycja z licznikiem „Do decyzji”. */
  licznik?: boolean;
};

export type GrupaNawigacji = { tytul: string | null; pozycje: PozycjaNawigacji[] };

export const NAWIGACJA: GrupaNawigacji[] = [
  {
    tytul: null,
    pozycje: [
      { label: "Dziś", href: "/", icon: Sun },
      { label: "Do decyzji", href: "/decyzje", icon: Inbox, licznik: true },
      { label: "Trade'y", href: "/trades", icon: ListOrdered },
    ],
  },
  {
    tytul: "Analiza",
    pozycje: [
      { label: "Playbook", href: "/playbook", icon: BookOpen },
      { label: "Przegląd", href: "/przeglad", icon: ClipboardCheck },
      { label: "Statystyki", href: "/stats", icon: BarChart3 },
      { label: "Kalendarz", href: "/calendar", icon: CalendarDays },
      { label: "Backtest", href: "/backtest", icon: FlaskConical },
    ],
  },
  {
    tytul: "Konta i wiedza",
    pozycje: [
      { label: "Prop", href: "/prop", icon: Wallet },
      { label: "Mózg", href: "/mozg", icon: Brain },
    ],
  },
];

export const USTAWIENIA: PozycjaNawigacji = { label: "Ustawienia", href: "/settings", icon: Settings };

export function czyAktywna(pathname: string, href: string | null): boolean {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
