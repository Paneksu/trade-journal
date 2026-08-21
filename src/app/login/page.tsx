import { redirect } from "next/navigation";

import { isSignedIn } from "@/lib/auth/guard";
import { LoginForm } from "./login-form";

export const metadata = { title: "Logowanie — Dziennik tradingowy" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ wroc?: string }>;
}) {
  if (await isSignedIn()) redirect("/");
  const { wroc } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="etykieta">Dziennik tradingowy</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
            Wpisz hasło, żeby wejść
          </h1>
          <p className="mt-2 text-sm text-muted">
            Dostęp ma tylko właściciel dziennika. Po ośmiu nieudanych próbach wejście blokuje
            się na dziesięć minut.
          </p>
        </div>
        <LoginForm back={wroc ?? ""} />
      </div>
    </main>
  );
}
