import { redirect } from "next/navigation";

import { getSettings, isSignedIn } from "@/lib/auth/guard";
import { pendingTwoFactorVersion } from "@/lib/auth/session";
import { CodeForm, LoginForm } from "./login-form";

export const metadata = { title: "Logowanie — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

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
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="etykieta">Dziennik tradingowy</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
            {drugiKrok ? "Wpisz kod z aplikacji" : "Wpisz hasło, żeby wejść"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {drugiKrok
              ? "Hasło przyjęte. Kod zmienia się co 30 sekund. Kod zapasowy działa raz."
              : "Dostęp ma tylko właściciel dziennika. Po ośmiu nieudanych próbach wejście blokuje się na dziesięć minut."}
          </p>
        </div>
        {drugiKrok ? <CodeForm back={wroc ?? ""} /> : <LoginForm back={wroc ?? ""} />}
      </div>
    </main>
  );
}
