"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import QRCode from "qrcode";

import { requireSession } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import {
  sprawdzDrugiSkladnik,
  wlaczTotp,
  wygenerujKodyZapasowe,
  wylaczTotp,
} from "@/lib/auth/second-factor";
import {
  clearSudoCookie,
  clearTotpSetupCookie,
  readTotpSetupCookie,
  setSessionCookie,
  setSudoCookie,
  setTotpSetupCookie,
} from "@/lib/auth/session";
import {
  adresOtpauth,
  formatujKodZapasowy,
  kluczTotpDziala,
  normalizujKod,
  nowySekretBase32,
  sprawdzKodTotp,
  zaszyfrujSekret,
} from "@/lib/auth/totp";
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

/*
 * Akcje z Ustawienia -> Bezpieczenstwo (ADR-031). Kazda zaczyna od `requireSession`:
 * autoryzacja przy KAZDYM zadaniu, nie tylko przy wejsciu na strone. Kody i hasla
 * nie trafiaja do logow ani do `auth_events`.
 */

const BRAK_KLUCZA =
  "Serwer nie ma poprawnego TOTP_ENC_KEY, więc nie może bezpiecznie zapisać sekretu. Ustaw zmienną w panelu wdrożeniowym (instrukcja: docs/wdrozenie-coolify.md) i uruchom aplikację ponownie.";

/** Sprawdza kod w trybie sudo/potwierdzenia: liczy porazki do wspolnej blokady. */
async function sprawdzKodUzytkownika(kod: string): Promise<{ ok: true; rodzaj: "totp" | "backup" } | { ok: false; error: string }> {
  const blokada = await sprawdzBlokade(true);
  if (blokada.zablokowany) return { ok: false, error: blokada.komunikat };
  let wynik;
  try {
    wynik = await sprawdzDrugiSkladnik(kod);
  } catch (e) {
    console.error("[auth] nie udało się sprawdzić kodu 2FA w ustawieniach:", e);
    return { ok: false, error: "Nie można teraz sprawdzić kodu. Szczegóły są w logach serwera." };
  }
  if (!wynik.ok) {
    await zapiszNiepowodzenie(true);
    await zdarzenie("totp_fail", { powod: wynik.powod, kontekst: "ustawienia" });
    return {
      ok: false,
      error:
        wynik.powod === "powtorka"
          ? "Ten kod został już użyty. Poczekaj na następny (zmienia się co 30 s)."
          : "Nieprawidłowy kod.",
    };
  }
  return { ok: true, rodzaj: wynik.rodzaj };
}

/* --- tryb sudo ---------------------------------------------------------------------- */

export type SudoState = { ok?: boolean; error?: string };

export async function enterSudo(_p: SudoState, data: FormData): Promise<SudoState> {
  const s = await requireSession();
  if (!s.totpEnabledAt) return { error: "Tryb sudo działa po włączeniu 2FA. Najpierw włącz 2FA poniżej." };

  const wynik = await sprawdzKodUzytkownika(String(data.get("kod") ?? ""));
  if (!wynik.ok) return { error: wynik.error };

  await wyczyscBlokade();
  await setSudoCookie(s.sessionVersion);
  await zdarzenie("sudo", { rodzaj: wynik.rodzaj });
  if (wynik.rodzaj === "backup") await zdarzenie("backup_code_used", { kontekst: "sudo" });
  revalidatePath("/settings/security");
  return { ok: true };
}

export async function leaveSudo(): Promise<void> {
  await requireSession();
  await clearSudoCookie();
  revalidatePath("/settings/security");
}

/* --- wlaczanie 2FA ---------------------------------------------------------------------- */

export type SetupStartState = { error?: string; qr?: string; sekret?: string };

/** Krok 1: haslo -> nowy sekret, pokazany jako QR. Do bazy nic nie trafia przed potwierdzeniem kodem. */
export async function startTotpSetup(_p: SetupStartState, data: FormData): Promise<SetupStartState> {
  const s = await requireSession();
  if (s.totpEnabledAt) return { error: "2FA jest już włączone." };
  if (!kluczTotpDziala()) return { error: BRAK_KLUCZA };

  const blokada = await sprawdzBlokade(false);
  if (blokada.zablokowany) return { error: blokada.komunikat };

  if (!(await verifyPassword(String(data.get("haslo") ?? ""), s.passwordHash))) {
    await zapiszNiepowodzenie(false);
    await zdarzenie("login_fail", { powod: "haslo_przy_wlaczaniu_2fa" });
    return { error: "Nieprawidłowe hasło." };
  }

  const sekret = nowySekretBase32();
  await setTotpSetupCookie(s.sessionVersion, sekret);
  const qr = await QRCode.toDataURL(adresOtpauth(sekret), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 240,
    // Celowo stale #000/#fff, nie tokeny motywu: czytniki QR wymagaja wysokiego kontrastu
    // ciemny-na-jasnym i jasnego pola ciszy wokol kodu, a motyw aplikacji jest ciemny.
    color: { dark: "#000000", light: "#ffffff" },
  });
  return { qr, sekret };
}

export type SetupConfirmState = { error?: string; kody?: string[]; wygaslo?: boolean };

/** Krok 2: kod z aplikacji potwierdza sekret. Dopiero teraz 2FA sie wlacza, a kody zapasowe powstaja. */
export async function confirmTotpSetup(
  _p: SetupConfirmState,
  data: FormData,
): Promise<SetupConfirmState> {
  const s = await requireSession();
  if (s.totpEnabledAt) return { error: "2FA jest już włączone." };

  const sekret = await readTotpSetupCookie(s.sessionVersion);
  if (!sekret) {
    return { wygaslo: true, error: "Sesja konfiguracji wygasła (10 min). Zacznij od początku." };
  }

  const blokada = await sprawdzBlokade(true);
  if (blokada.zablokowany) return { error: blokada.komunikat };

  const krok = sprawdzKodTotp(sekret, normalizujKod(String(data.get("kod") ?? "")));
  if (krok === null) {
    await zapiszNiepowodzenie(true);
    await zdarzenie("totp_fail", { powod: "zly_kod", kontekst: "wlaczanie_2fa" });
    return { error: "Nieprawidłowy kod. Sprawdź, czy aplikacja pokazuje wpis „Dziennik tradingowy”, i wpisz bieżący kod." };
  }

  const wlaczone = await wlaczTotp(zaszyfrujSekret(sekret), krok);
  if (!wlaczone) return { error: "2FA zostało już włączone w innym oknie." };

  await clearTotpSetupCookie();
  // Wersja sesji poszla w gore: stare ciasteczka (takze z innych urzadzen) przestaja dzialac,
  // a biezaca przegladarka dostaje nowe od razu.
  await setSessionCookie(wlaczone.wersja);
  await wyczyscBlokade();
  await zdarzenie("totp_enabled");
  revalidatePath("/", "layout");
  return { kody: wlaczone.kody.map(formatujKodZapasowy) };
}

/* --- czynnosci wymagajace sudo ------------------------------------------------------------- */

export type BackupState = { error?: string; kody?: string[] };

export async function regenerateBackupCodes(): Promise<BackupState> {
  const s = await requireSession();
  if (!s.totpEnabledAt) return { error: "Kody zapasowe istnieją tylko przy włączonym 2FA." };
  if ((await stanSudo(s)).stan !== "aktywny") return { error: KOMUNIKAT_SUDO };

  const kody = await wygenerujKodyZapasowe();
  await zdarzenie("backup_codes_regenerated");
  revalidatePath("/settings/security");
  return { kody: kody.map(formatujKodZapasowy) };
}

export type DisableState = { ok?: boolean; error?: string };

export async function disableTotp(): Promise<DisableState> {
  const s = await requireSession();
  if (!s.totpEnabledAt) return { error: "2FA jest już wyłączone." };
  if ((await stanSudo(s)).stan !== "aktywny") return { error: KOMUNIKAT_SUDO };

  const wersja = await wylaczTotp();
  if (wersja === null) return { error: "2FA jest już wyłączone." };

  await clearSudoCookie();
  await setSessionCookie(wersja);
  await zdarzenie("totp_disabled");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Wylogowuje wszystkie urzadzenia (podbicie wersji sesji). Odcinanie dostepu ma byc latwe: bez sudo. */
export async function logoutEverywhere(): Promise<void> {
  await requireSession();
  // Podbicie atomowo w bazie (nie "odczytana wersja + 1"): dwa rownolegle wywolania nie dostana
  // tej samej nowej wersji, wiec nie wyjda z tego dwa rownoczesnie wazne ciasteczka.
  const [{ nowa }] = await db
    .update(settings)
    .set({ sessionVersion: sql`${settings.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .returning({ nowa: settings.sessionVersion });
  await clearSudoCookie();
  await setSessionCookie(nowa);
  await zdarzenie("logout_all");
  revalidatePath("/", "layout");
}
