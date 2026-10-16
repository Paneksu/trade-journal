"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { celWAplikacji } from "@/lib/auth/cel";
import { checkPasswordStrength, hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  clearPendingTwoFactorCookie,
  clearSessionCookie,
  pendingTwoFactorVersion,
  setPendingTwoFactorCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { getSettings, requireSession } from "@/lib/auth/guard";
import { sprawdzDrugiSkladnik } from "@/lib/auth/second-factor";
import {
  KOMUNIKAT_SUDO,
  sprawdzBlokade,
  stanSudo,
  wyczyscBlokade,
  zapiszNiepowodzenie,
  zdarzenie,
} from "@/lib/auth/zadanie";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export type SignInState = { error?: string };

/**
 * Krok 1: haslo. Gdy 2FA jest wlaczone, haslo daje tylko krotkie ciasteczko
 * "czeka na drugi krok" - sesja powstaje dopiero po kodzie (`verifySecondFactor`).
 * Blokada (8 prob) liczy bledne hasla i bledne kody razem, a poprawne haslo jej
 * NIE zeruje, gdy czeka drugi krok - inaczej kto zna haslo, mialby nieskonczenie
 * wiele prob kodu przez przeplatanie.
 */
export async function signIn(_p: SignInState, data: FormData): Promise<SignInState> {
  const blokada = await sprawdzBlokade(false);
  if (blokada.zablokowany) return { error: blokada.komunikat };

  const password = String(data.get("haslo") ?? "");
  const s = await getSettings();

  if (!(await verifyPassword(password, s.passwordHash))) {
    await zapiszNiepowodzenie(false);
    await zdarzenie("login_fail", { powod: "haslo" });
    return { error: "Nieprawidłowe hasło." };
  }

  const back = celWAplikacji(String(data.get("wroc") ?? ""));

  if (s.totpEnabledAt) {
    await setPendingTwoFactorCookie(s.sessionVersion);
    redirect(back === "/" ? "/login" : `/login?wroc=${encodeURIComponent(back)}`);
  }

  await wyczyscBlokade();
  await setSessionCookie(s.sessionVersion);
  await zdarzenie("login_ok", { totp: false });
  redirect(back);
}

/** Krok 2: kod z aplikacji albo kod zapasowy. */
export async function verifySecondFactor(_p: SignInState, data: FormData): Promise<SignInState> {
  const s = await getSettings();
  const wersja = await pendingTwoFactorVersion();
  if (wersja === null || wersja !== s.sessionVersion || !s.totpEnabledAt) {
    await clearPendingTwoFactorCookie();
    return { error: "Logowanie wygasło. Wpisz hasło jeszcze raz." };
  }

  const blokada = await sprawdzBlokade(true);
  if (blokada.zablokowany) return { error: blokada.komunikat };

  const kod = String(data.get("kod") ?? "");
  let wynik;
  try {
    wynik = await sprawdzDrugiSkladnik(kod);
  } catch (e) {
    console.error(
      "[auth] nie udało się sprawdzić kodu 2FA (sprawdź, czy TOTP_ENC_KEY (albo SESSION_SECRET, gdy TOTP_ENC_KEY nie ma) jest taki sam jak przy włączaniu 2FA):",
      e,
    );
    return { error: "Nie można teraz sprawdzić kodu. Szczegóły są w logach serwera." };
  }

  if (!wynik.ok) {
    await zapiszNiepowodzenie(true);
    await zdarzenie("totp_fail", { powod: wynik.powod });
    return {
      error:
        wynik.powod === "powtorka"
          ? "Ten kod został już użyty. Poczekaj na następny (zmienia się co 30 s)."
          : "Nieprawidłowy kod.",
    };
  }

  await wyczyscBlokade();
  await clearPendingTwoFactorCookie();
  await setSessionCookie(s.sessionVersion);
  await zdarzenie(wynik.rodzaj === "backup" ? "backup_code_used" : "totp_ok");
  await zdarzenie("login_ok", { totp: true, rodzaj: wynik.rodzaj });

  redirect(celWAplikacji(String(data.get("wroc") ?? "")));
}

/** Wraca z kroku kodu do hasla (np. po pomylce). */
export async function cancelSecondFactor(): Promise<void> {
  await clearPendingTwoFactorCookie();
  redirect("/login");
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export type PasswordState = { ok?: boolean; error?: string };

export async function changePassword(_p: PasswordState, data: FormData): Promise<PasswordState> {
  const s = await requireSession();

  // Przy wlaczonym 2FA zmiana hasla wymaga trybu sudo (ADR-031).
  if ((await stanSudo(s)).stan === "wymagany") return { error: KOMUNIKAT_SUDO };

  const blokada = await sprawdzBlokade(false);
  if (blokada.zablokowany) return { error: blokada.komunikat };

  const current = String(data.get("obecne") ?? "");
  const next = String(data.get("nowe") ?? "");
  const repeated = String(data.get("powtorzone") ?? "");

  if (!(await verifyPassword(current, s.passwordHash))) {
    await zapiszNiepowodzenie(false);
    await zdarzenie("login_fail", { powod: "obecne_haslo_przy_zmianie" });
    return { error: "Obecne hasło się nie zgadza." };
  }
  if (next !== repeated) return { error: "Nowe hasła nie są takie same." };

  const strength = checkPasswordStrength(next);
  if (!strength.ok) return { error: strength.reason };

  // Podbicie wersji sesji uniewaznia wszystkie stare ciasteczka, takze te
  // z innych urzadzen. Biezaca sesje odnawiamy od razu.
  // Warunek na wersji odczytanej na poczatku: gdy w miedzyczasie ktos ja podbil (wylogowanie
  // wszedzie, druga zmiana hasla), nie nadpisujemy cudzej zmiany i nie wydajemy ciasteczka.
  const zmienione = await db
    .update(settings)
    .set({
      passwordHash: await hashPassword(next),
      sessionVersion: s.sessionVersion + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(settings.id, 1), eq(settings.sessionVersion, s.sessionVersion)))
    .returning({ id: settings.id });
  if (zmienione.length === 0) {
    return { error: "Sesja zmieniła się w trakcie zapisu (wylogowanie z innego urządzenia albo druga zmiana hasła). Zaloguj się ponownie i spróbuj jeszcze raz." };
  }

  await setSessionCookie(s.sessionVersion + 1);
  await zdarzenie("password_changed");
  revalidatePath("/", "layout");
  return { ok: true };
}
