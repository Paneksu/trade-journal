import { redirect } from "next/navigation";

import { getSettings, isSignedIn } from "@/lib/auth/guard";
import { pendingTwoFactorVersion } from "@/lib/auth/session";
import { CodeForm, LoginForm } from "./login-form";

export const metadata = { title: "Logowanie — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

/*
 * Logowanie (UI v2; Słowa użytkownika 16.10.2026: «ulepsz także wygląd na bardziej stylowy pierwszego ekranu logowania»).
 * Forma ze wzoru: Mercury Log in (żywy zrzut docs/design/wzory/panel-logowanie-mercury-1440.png, pomiar
 * pomiar-logowanie-mercury.json): jedna karta ok. 440 px na środku, tytuł 19/28 w karcie, etykieta nad polem,
 * pigułkowy przycisk 40 px; Shuttle (Refero 49bf1064): duży znak nad formularzem na ciemnym tle.
 * Marka: pełny znak FVG V1 z poświatą (docs/design/znak/runda-4-fvg/v1-bycza-ce), siatka wykresu 4% w tle jak w
 * znaku, IBM Plex, akcent tylko na przycisku „Zaloguj”. Bez haseł reklamowych. Logika bez zmian: blokada po błędach,
 * powrót `wroc` przez cel.ts, ciasteczka (lib/actions/auth.ts).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ wroc?: string }>;
}) {
  if (await isSignedIn()) redirect("/");
  const { wroc } = await searchParams;

  // Drugi krok pokazujemy tylko wtedy, gdy haslo juz przeszlo i ciasteczko jest wazne
  // dla biezacej wersji sesji.
  const wersja = await pendingTwoFactorVersion();
  const ustawienia = wersja === null ? null : await getSettings();
  const drugiKrok = ustawienia !== null && ustawienia.totpEnabledAt !== null && wersja === ustawienia.sessionVersion;

  return (
    <main
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-bg px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
    >
      {/* Siatka wykresu 4% i poświata za znakiem (jak w znaku FVG); czysta dekoracja. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_50%_38%,black_0%,transparent_70%)]"
      />
      <div aria-hidden className="pointer-events-none absolute top-[18%] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(232_164_76/0.16)_0%,transparent_65%)]" />

      <div className="relative w-full max-w-[27.5rem]">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- statyczny SVG znaku, bez optymalizacji obrazów */}
          <img src="/icons/znak-pelny.svg" alt="" width={120} height={120} className="size-24 drop-shadow-[0_18px_44px_rgb(232_164_76/0.26)] sm:size-[120px]" />
          <p className="mt-4 text-sekcja font-medium tracking-tight text-text">Dziennik</p>
        </div>

        <section className="karta px-6 py-7 sm:px-10 sm:py-9">
          <h1 id="logowanie-h" className="text-sekcja font-normal text-text">
            {drugiKrok ? "Wpisz kod z aplikacji" : "Wpisz hasło, żeby wejść"}
          </h1>
          <p className="mt-1 text-meta text-muted">
            {drugiKrok ? "Hasło przyjęte. Kod zmienia się co 30 sekund." : "Dostęp ma tylko właściciel dziennika."}
          </p>
          <div className="mt-6">{drugiKrok ? <CodeForm back={wroc ?? ""} /> : <LoginForm back={wroc ?? ""} />}</div>
        </section>

        <p className="mt-5 text-center text-meta text-muted">
          {drugiKrok ? "Kod zapasowy działa raz." : "Po ośmiu nieudanych próbach wejście blokuje się na dziesięć minut."}
        </p>
      </div>
    </main>
  );
}
