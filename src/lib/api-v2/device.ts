import "server-only";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { apiTokens, deviceCodes } from "@/lib/db/schema";

import { kodBleduBazy } from "./bledy-bazy";
import { czyScope, type Scope } from "./scopes";
import {
  skrotKoduUrzadzenia,
  wygenerujKodUrzadzenia,
  wygenerujKodUzytkownika,
  wygenerujToken,
} from "./token";

/**
 * Logowanie kodem urzadzenia (ADR-030, wzor RFC 8628). `tj login` dostaje
 * `user_code`, uzytkownik PRZEPISUJE go w aplikacji (nie klika gotowego linku -
 * utrudnia to phishing kodem urzadzenia), a CLI odpytuje o token. Token
 * powstaje dopiero przy odpytaniu PO zatwierdzeniu i wraca dokladnie raz:
 * jawny token nie lezy w bazie ani chwili.
 */

export const WAZNOSC_KODU_S = 600;
export const INTERWAL_ODPYTYWANIA_S = 5;
/**
 * Globalny limit niewygaslych, nierozstrzygnietych zadan. Kod urzadzenia zyje 10 minut, a
 * zalew zadan to droga do phishingu kodem (uzytkownik zatwierdza "to, co akurat jest
 * na liscie"), wiec nadmiar odrzucamy zamiast kolejkowac.
 */
export const LIMIT_OCZEKUJACYCH = 20;

export type WynikStartu = {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

export type WynikStartuLubOdmowa = ({ ok: true } & WynikStartu) | { ok: false; kod: "too_many_pending"; komunikat: string };

export async function rozpocznijUrzadzenie(
  nazwaKlienta: string,
  zakresy: Scope[],
  adresKlienta: string,
): Promise<WynikStartuLubOdmowa> {
  // Sprzatanie po 10 minutach (czas zycia kodu), nie po dobie: wygasle zadania nie maja po co lezec w bazie.
  await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, sql`now()`));

  // Kolizja user_code (20^8 mozliwosci) jest praktycznie niemozliwa, ale unikat w bazie jest
  // ostateczny, wiec ponawiamy zamiast zwracac 500. Kazda proba to JEDNA transakcja:
  // blokada doradcza -> liczenie limitu -> wstawienie, wiec rownolegle starty z wielu adresow
  // nie przekrocza limitu (audyt N2: wczesniej wstawienie szlo juz po zwolnieniu blokady).
  for (let proba = 0; proba < 5; proba += 1) {
    const { deviceCode, sha256 } = wygenerujKodUrzadzenia();
    const userCode = wygenerujKodUzytkownika();
    try {
      const wynik = await db.transaction(async (tx): Promise<WynikStartuLubOdmowa> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tj.device.pending'))`);
        const [w] = await tx
          .select({ ile: sql<number>`count(*)::int` })
          .from(deviceCodes)
          .where(and(isNull(deviceCodes.approvedAt), isNull(deviceCodes.deniedAt), isNull(deviceCodes.consumedAt), gt(deviceCodes.expiresAt, sql`now()`)));
        const ile = w?.ile ?? 0;
        if (ile >= LIMIT_OCZEKUJACYCH) {
          return {
            ok: false,
            kod: "too_many_pending",
            komunikat: `W aplikacji czeka już ${ile} niezatwierdzonych żądań logowania urządzeń (limit ${LIMIT_OCZEKUJACYCH}). Poczekaj do 10 minut, aż wygasną, albo odrzuć je na stronie Urządzenia (przycisk „Odrzuć wszystkie oczekujące”). Jeśli to nie Ty je wysłałeś, ktoś próbuje wyłudzić zatwierdzenie.`,
          };
        }
        await tx.insert(deviceCodes).values({
          deviceCodeSha256: sha256,
          userCode,
          clientName: nazwaKlienta,
          clientIp: adresKlienta,
          requestedScopes: zakresy,
          expiresAt: sql`now() + ${WAZNOSC_KODU_S} * interval '1 second'`,
        });
        return { ok: true, deviceCode, userCode, expiresIn: WAZNOSC_KODU_S, interval: INTERWAL_ODPYTYWANIA_S };
      });
      return wynik;
    } catch (e) {
      if (kodBleduBazy(e) === "23505") continue;
      throw e;
    }
  }
  throw new Error("Nie udało się wylosować unikalnego kodu urządzenia w 5 próbach (kolizje user_code).");
}

export type WynikOdpytania =
  | { ok: true; accessToken: string; tokenId: number; scopes: Scope[] }
  | {
      ok: false;
      status: 400 | 403 | 429;
      kod: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant";
      komunikat: string;
    };

/** Jedno odpytanie `device/token`. Cala sciezka w jednej transakcji z blokada wiersza. */
export async function odpytajUrzadzenie(deviceCode: string): Promise<WynikOdpytania> {
  const sha = skrotKoduUrzadzenia(deviceCode);

  return db.transaction(async (tx): Promise<WynikOdpytania> => {
    // FOR UPDATE: dwa rownolegle odpytania tego samego zatwierdzonego kodu nie wydadza dwoch tokenow.
    const wynik = await tx.execute<{
      id: number;
      client_name: string;
      granted_scopes: string[] | null;
      approved_at: Date | null;
      denied_at: Date | null;
      consumed_at: Date | null;
      expired: boolean;
      sekund_od_odpytania: number | null;
    }>(sql`
      select id, client_name, granted_scopes, approved_at, denied_at, consumed_at,
             (expires_at <= now()) as expired,
             extract(epoch from (now() - last_polled_at))::float8 as sekund_od_odpytania
        from device_codes
       where device_code_sha256 = ${sha}
       for update`);
    const w = wynik[0];
    if (!w) {
      return {
        ok: false,
        status: 400,
        kod: "invalid_grant",
        komunikat: "Nieznany kod urządzenia. Zacznij od nowa: `tj login`.",
      };
    }
    if (w.consumed_at) {
      return {
        ok: false,
        status: 400,
        kod: "invalid_grant",
        komunikat: "Ten kod urządzenia został już zrealizowany (token wydaje się raz). Zacznij od nowa: `tj login`.",
      };
    }
    if (w.denied_at) {
      return {
        ok: false,
        status: 403,
        kod: "access_denied",
        komunikat: "Użytkownik odrzucił to urządzenie w aplikacji. Zacznij od nowa: `tj login`, jeśli to pomyłka.",
      };
    }
    if (w.expired) {
      return {
        ok: false,
        status: 400,
        kod: "expired_token",
        komunikat: `Kod urządzenia wygasł (ważny ${WAZNOSC_KODU_S / 60} min). Zacznij od nowa: \`tj login\`.`,
      };
    }
    if (!w.approved_at) {
      if (w.sekund_od_odpytania !== null && w.sekund_od_odpytania < INTERWAL_ODPYTYWANIA_S - 0.5) {
        await tx.execute(sql`update device_codes set last_polled_at = now() where id = ${w.id}`);
        return {
          ok: false,
          status: 429,
          kod: "slow_down",
          komunikat: `Odpytujesz za często. Pytaj co najmniej co ${INTERWAL_ODPYTYWANIA_S} s.`,
        };
      }
      await tx.execute(sql`update device_codes set last_polled_at = now() where id = ${w.id}`);
      return {
        ok: false,
        status: 400,
        kod: "authorization_pending",
        komunikat: "Czekam na zatwierdzenie w aplikacji (Ustawienia → Urządzenia → Połącz urządzenie).",
      };
    }

    const zakresy = (w.granted_scopes ?? []).filter(czyScope);
    if (zakresy.length === 0) {
      // Nie powinno sie zdarzyc: CHECK wymaga zakresow przy zatwierdzeniu, a UI wymaga co najmniej jednego.
      throw new Error(`Zatwierdzony kod urządzenia #${w.id} nie ma żadnego poprawnego zakresu (granted_scopes: ${JSON.stringify(w.granted_scopes)}).`);
    }

    const nowy = wygenerujToken();
    const [token] = await tx
      .insert(apiTokens)
      .values({
        name: w.client_name,
        prefix: nowy.prefix,
        tokenSha256: nowy.sha256,
        scopes: zakresy,
        createdVia: "device_code",
      })
      .returning({ id: apiTokens.id });

    const zuzyte = await tx
      .update(deviceCodes)
      .set({ consumedAt: sql`now()`, tokenId: token.id, lastPolledAt: sql`now()` })
      .where(and(eq(deviceCodes.id, w.id), sql`${deviceCodes.consumedAt} is null`))
      .returning({ id: deviceCodes.id });
    if (zuzyte.length !== 1) {
      throw new Error(`Kod urządzenia #${w.id} został zrealizowany w trakcie tej transakcji; przerywam, żeby nie wydać drugiego tokenu.`);
    }
    return { ok: true, accessToken: nowy.token, tokenId: token.id, scopes: zakresy };
  });
}

/** Adres, pod ktorym uzytkownik przepisuje kod. `APP_PUBLIC_URL` wygrywa (za proxy host bywa wewnetrzny). */
export function adresPolaczenia(request: Request): string {
  const baza = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (baza) return `${baza}/urzadzenia/polacz`;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",").pop()?.trim() || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",").pop()?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}/urzadzenia/polacz`;
}
