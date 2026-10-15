import { createHash } from "node:crypto";
import { z } from "zod";

import type { Scope } from "../scopes";
import {
  AdnotacjeListaQuery,
  AdnotacjeZapisSchema,
  DopisekNotatkiSchema,
  KorektaInterpretacjiSchema,
  KorektaWerdyktuSchema,
  LukaUtworzSchema,
  LukiListaQuery,
  MentorTwierdzeniaListaQuery,
  MentorTwierdzeniaZapisSchema,
  MentorTwierdzenieScalSchema,
  MentorZrodlaListaQuery,
  MentorZrodloSchema,
  MentorZrodloStatusSchema,
  PlanDopisekSchema,
  PlanPrzypiecieSchema,
  PlanUtworzSchema,
  PlanyListaQuery,
  PropKsiegaWpisSchema,
  PropOverviewQuery,
  PropPresetyQuery,
  PropRegulyUtworzSchema,
  PropStatusQuery,
  PrzegladTygodniaQuery,
  PrzegladTygodniaZapisSchema,
  SetupUtworzSchema,
  SetupWersjaSchema,
  SetupyListaQuery,
  SugestiaUtworzSchema,
  SugestieListaQuery,
  WariantUtworzSchema,
} from "./funkcje";
import {
  AdnotacjeListaOdpowiedz,
  AdnotacjeZapisOdpowiedz,
  DopisekOdpowiedz,
  DopiskiListaOdpowiedz,
  DzienOdpowiedz,
  DzienZapisOdpowiedz,
  HipotezaZapisOdpowiedz,
  HipotezyListaOdpowiedz,
  KorektaInterpretacjiOdpowiedz,
  KorektaWerdyktuOdpowiedz,
  LukaZadanaOdpowiedz,
  LukaZapisOdpowiedz,
  LukiListaOdpowiedz,
  MeOdpowiedz,
  MentorTwierdzeniaListaOdpowiedz,
  MentorTwierdzeniaZapisOdpowiedz,
  MentorTwierdzenieOut,
  MentorZrodlaListaOdpowiedz,
  MentorZrodloOut,
  MentorZrodloZapisOdpowiedz,
  MetaOdpowiedz,
  NotatkaSzczegolyOdpowiedz,
  NotatkiListaOdpowiedz,
  OcenaZapisOdpowiedz,
  PlanDopisekOut,
  PlanSzczegolyOdpowiedz,
  PlanyListaOdpowiedz,
  PlanZapisOdpowiedz,
  PominieciaOdpowiedz,
  ProfilOdpowiedz,
  PropKsiegaOdpowiedz,
  PropKsiegaZapisOdpowiedz,
  PropOverviewOdpowiedz,
  PropPresetyOdpowiedz,
  PropRegulyListaOdpowiedz,
  PropRegulyOut,
  PropStatusOdpowiedz,
  PropozycjaRegulyOdpowiedz,
  PrzegladTygodniaOdpowiedz,
  PrzegladZapisOdpowiedz,
  ReguliListaOdpowiedz,
  SesjaOdpowiedz,
  SetupSzczegolyOdpowiedz,
  SetupWersjaZapisOdpowiedz,
  SetupyListaOdpowiedz,
  SetupZapisOdpowiedz,
  SlowaListaOdpowiedz,
  SugestieListaOdpowiedz,
  SugestiaZapisOdpowiedz,
  SzukajOdpowiedz,
  TradeSzczegolyOdpowiedz,
  TradesListaOdpowiedz,
  TradesZapisOdpowiedz,
  WariantyOdpowiedz,
  WariantZapisOdpowiedz,
  ZalacznikiOdpowiedz,
  ZrzutyOdpowiedz,
} from "./odpowiedzi";
import {
  KopertaTradowSchema,
  OcenaSchema,
  OminieciaSchema,
  REGEX_EXTERNAL_REF,
  SesjaSchema,
} from "./schemas";
import {
  BladOdpowiedz,
  DeviceStartOdpowiedz,
  DeviceStartSchema,
  DeviceTokenOdpowiedz,
  DeviceTokenSchema,
  DzienQuery,
  DzienZapisSchema,
  HipotezaUtworzSchema,
  HipotezyListaQuery,
  InterpretacjaSchema,
  NotatkaOdpowiedz,
  NotatkaUtworzSchema,
  NotatkaZmienSchema,
  NotatkiListaQuery,
  PropozycjaReguly,
  ReguliListaQuery,
  SlowaListaQuery,
  SlowaOdpowiedz,
  SlowaUtworzSchema,
  SzukajQuery,
} from "./v2";

/**
 * Rejestr tras API v2 - jedyne zrodlo, z ktorego powstaje `docs/openapi-v2.json`
 * i `contractHash` z `GET /meta` (ADR-030). Test (`endpoints.test.ts`) pilnuje
 * trzech rzeczy: plik OpenAPI jest aktualny, kazda trasa w `src/app/api/v2` ma
 * wpis tutaj, a kazdy wpis ma trase. Dryf kontraktu jest wiec widoczny, zanim
 * cokolwiek sie zepsuje u klienta (`tj doctor` porownuje hash).
 */

export const WERSJA_KONTRAKTU = "2.0.0";

export const TradesListaQuery = z.strictObject({
  refs: z
    .string()
    .optional()
    .transform((w) => (w ? w.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().regex(REGEX_EXTERNAL_REF, { message: "oczekiwano formatu tv:<id> albo fxr:<id>" })).max(100)),
  source: z.enum(["tradingview", "fxreplay"]).optional(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type Metoda = "get" | "post" | "put" | "patch";

const POLA_META_ZRZUTOW = {
  capturedAt: { type: "array", items: { type: "string", format: "date-time" }, description: "Kiedy zrobiono zrzut (ISO 8601 z offsetem); po jednym na plik, w tej samej kolejnosci." },
  chartState: { type: "array", items: { type: "string" }, description: "Obiekt JSON jako tekst (symbol, interwal, zakres z tj shot); po jednym na plik." },
};

const MULTIPART_ZRZUTY = {
  type: "object",
  properties: {
    shot: { type: "array", items: { type: "string", format: "binary" }, description: "Plik PNG, JPG, WebP, AVIF albo HEIC; powtarzalne, do 8." },
    interval: { type: "array", items: { type: "string" }, description: "Interwal; po jednym na plik, w tej samej kolejnosci." },
    ...POLA_META_ZRZUTOW,
    origin: { type: "string", enum: ["tradingview", "fxreplay", "manual"], description: "tradingview / fxreplay zastepuja swoje poprzednie wydanie; manual (zdjecie od uzytkownika) tylko dopisuje." },
  },
  required: ["shot"],
};

const MULTIPART_ZALACZNIKI = {
  type: "object",
  properties: {
    shot: { type: "array", items: { type: "string", format: "binary" }, description: "Plik PNG, JPG, WebP, AVIF albo HEIC; powtarzalne, do 8." },
    interval: { type: "array", items: { type: "string" }, description: "Interwal; po jednym na plik." },
    caption: { type: "array", items: { type: "string", maxLength: 500 }, description: "Podpis; po jednym na plik." },
    ...POLA_META_ZRZUTOW,
    origin: { type: "string", enum: ["manual", "tradingview", "fxreplay"], default: "manual" },
  },
  required: ["shot"],
};

export type Endpoint = {
  metoda: Metoda;
  /** Sciezka OpenAPI wzgledem `/api/v2`, np. `/notes/{id}`. */
  sciezka: string;
  /** Wymagane zakresy; `null` = trasa publiczna (tylko device/start i device/token). */
  zakresy: Scope[] | null;
  opis: string;
  parametrySciezki?: string[];
  query?: z.ZodType;
  cialo?: z.ZodType;
  rodzajCiala?: "json" | "multipart";
  /** Opis pol multipart/form-data (domyslnie: zrzuty trade'a). */
  multipart?: Record<string, unknown>;
  odpowiedz?: z.ZodType;
  /** Kod sukcesu, domyslnie 200. */
  status?: number;
  /** Inne kody, ktore trasa zwraca z powodu reguly biznesowej (documentacja, nie walidacja). */
  bledy?: Record<number, string>;
  ifMatch?: boolean;
  /** Deklarowane pochodzenie vault-import / mentor (w user-words: source vault-import) wymaga dodatkowo zakresu `import` (403 bez niego). */
  wymagaImportuDlaOrigin?: boolean;
};

export const ENDPOINTS: Endpoint[] = [
  { metoda: "get", sciezka: "/meta", zakresy: ["read"], opis: "Slownik: konta, instrumenty, tagi, interwaly, limity, zakresy i contractHash kontraktu.", odpowiedz: MetaOdpowiedz },
  { metoda: "get", sciezka: "/me", zakresy: ["read"], opis: "Kim jest ten token: id, nazwa, zakresy i aktor zapisu (api:<id>). Bez sekretu i skrotu.", odpowiedz: MeOdpowiedz },

  { metoda: "get", sciezka: "/trades", zakresy: ["read"], opis: "Trady zapisane przez API ze skrotem tresci i znacznikiem edycji w aplikacji.", query: TradesListaQuery, odpowiedz: TradesListaOdpowiedz },
  { metoda: "post", sciezka: "/trades", zakresy: ["write"], opis: "Zapis paczki trade'ow (max 50) przez persistTrade/computeTrade. Wynik per pozycja.", cialo: KopertaTradowSchema, odpowiedz: TradesZapisOdpowiedz },
  { metoda: "get", sciezka: "/trades/{id}", zakresy: ["read"], opis: "Trade ze zrzutami, ocenami AI (z regulami i flaga look-ahead), planem, slowami uzytkownika, adnotacjami wykresu i powiazaniami. Wynik ukryty (resultHidden), dopoki trade z werdyktem AI nie jest zamkniety.", parametrySciezki: ["id"], odpowiedz: TradeSzczegolyOdpowiedz, bledy: { 404: "Trade nie istnieje." } },
  { metoda: "post", sciezka: "/trades/{id}/reviews", zakresy: ["write"], opis: "Ocena AI trade'a z regulami; jedna na podstawe (chart | history). Bez evidence ponowne wyslanie podmienia ocene (ADR-028); z evidence (swiece OHLC + sha256 zrzutow) werdykt jest NIEZMIENNY z as_of i evidence_hash (ADR-033): ta sama tresc to 200, inna to 409.", parametrySciezki: ["id"], cialo: OcenaSchema, odpowiedz: OcenaZapisOdpowiedz, status: 200, bledy: { 201: "Utworzona nowa ocena (200 przy podmianie albo ponowieniu tej samej tresci).", 404: "Trade nie istnieje.", 409: "Werdykt z as_of jest niezmienny; inna tresc to korekta (user_override).", 422: "Ocena »chart« widzi swiece pozniejsze niz wejscie, nieznany zrzut albo za nowy numer zestawu regul." } },
  { metoda: "patch", sciezka: "/trades/{id}/reviews/{reviewId}", zakresy: ["write"], opis: "ZAWSZE 409: werdykt AI jest niezmienny, korekta uzytkownika to nowy wpis (POST .../override).", parametrySciezki: ["id", "reviewId"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/trades/{id}/reviews/{reviewId}", zakresy: ["write"], opis: "ZAWSZE 409: werdykt AI jest niezmienny, korekta uzytkownika to nowy wpis (POST .../override).", parametrySciezki: ["id", "reviewId"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "post", sciezka: "/trades/{id}/reviews/{reviewId}/override", zakresy: ["write"], opis: "Korekta werdyktu AI przez uzytkownika: NOWY wiersz kind = user_override z as_of i skrotem, stary werdykt zostaje. Wymaga slow uzytkownika (wordsId).", parametrySciezki: ["id", "reviewId"], cialo: KorektaWerdyktuSchema, odpowiedz: KorektaWerdyktuOdpowiedz, status: 201, bledy: { 200: "Powtorka tej samej korekty (ten sam werdykt, slowa i tresc): zwracany jest istniejacy wiersz.", 404: "Werdykt nie nalezy do trade'a.", 422: "Slowa nie istnieja, nie dotycza tego trade'a (ani jego dnia handlowego) albo werdykt nie jest werdyktem AI." } },
  { metoda: "post", sciezka: "/trades/{id}/screenshots", zakresy: ["write"], opis: "Zrzuty (multipart: shot, interval, capturedAt, chartState, origin). Zrzuty AI (tradingview, fxreplay) zastepuja zrzuty tego samego pochodzenia; origin = manual (zdjecie od uzytkownika) tylko dopisuje i nie kasuje zrzutow AI. PNG, JPG, WebP, AVIF, HEIC.", parametrySciezki: ["id"], rodzajCiala: "multipart", odpowiedz: ZrzutyOdpowiedz, bledy: { 404: "Trade nie istnieje.", 413: "Za duze cialo.", 422: "Plik odrzucony albo limit 8 zrzutow." } },
  { metoda: "post", sciezka: "/backtest-sessions", zakresy: ["write"], opis: "Tworzy sesje backtestu/forward albo odnajduje ja po externalRef (idempotentne).", cialo: SesjaSchema, odpowiedz: SesjaOdpowiedz, bledy: { 201: "Utworzona nowa sesja (200 przy istniejacej)." } },
  { metoda: "post", sciezka: "/skips", zakresy: ["write"], opis: "Oznacza wpisy, ktorych klient nie chce w dzienniku.", cialo: OminieciaSchema, odpowiedz: PominieciaOdpowiedz },

  { metoda: "get", sciezka: "/days/{date}", zakresy: ["read"], opis: "Dzien: notatka dnia (z rytualem przed sesja), liczba trade'ow, slowa uzytkownika i notatki przypiete do dnia.", parametrySciezki: ["date"], query: DzienQuery, odpowiedz: DzienOdpowiedz },
  { metoda: "put", sciezka: "/days/{date}", zakresy: ["write"], opis: "Zapis notatki dnia (nadpisuje podane pola, takze bias, maxTrades i sleep; konto albo sesja backtestu wskazane w ciele).", parametrySciezki: ["date"], cialo: DzienZapisSchema, odpowiedz: DzienZapisOdpowiedz, bledy: { 201: "Utworzona nowa notatka dnia (200 przy zapisie do istniejacej).", 409: "Dzien ma trade'y, wiec nie moze byc oznaczony jako bez transakcji." } },
  { metoda: "post", sciezka: "/days/{date}/attachments", zakresy: ["write"], opis: "Zalaczniki dnia (multipart: shot, interval, caption, capturedAt, chartState, origin; query accountId albo sessionId). PNG, JPG, WebP, AVIF, HEIC -> WebP + miniatura. Tylko dopisywanie, do 8.", parametrySciezki: ["date"], query: DzienQuery, rodzajCiala: "multipart", multipart: MULTIPART_ZALACZNIKI, odpowiedz: ZalacznikiOdpowiedz, status: 201, bledy: { 413: "Za duze cialo.", 422: "Plik odrzucony albo limit 8 zalacznikow." } },

  { metoda: "get", sciezka: "/notes", zakresy: ["read"], opis: "Lista notatek (bez tresci); filtry kind, slug, externalRef, day, tradeId.", query: NotatkiListaQuery, odpowiedz: NotatkiListaOdpowiedz },
  { metoda: "post", sciezka: "/notes", zakresy: ["write"], wymagaImportuDlaOrigin: true, opis: "Tworzy notatke. Link [[Tytul]] do nieistniejacej notatki jest dozwolony. Rodzaje rule, hypothesis i setup maja wlasne trasy.", cialo: NotatkaUtworzSchema, odpowiedz: NotatkaOdpowiedz, status: 201, bledy: { 409: "Tytul, slug albo externalRef zajety (odpowiedz wskazuje istniejaca notatke).", 422: "Rodzaj zarzadzany przez wlasna trase (useInstead)." } },
  { metoda: "get", sciezka: "/notes/{id}", zakresy: ["read"], opis: "Notatka z trescia, rewizja (rev, tez w ETag), linkami i backlinkami.", parametrySciezki: ["id"], odpowiedz: NotatkaSzczegolyOdpowiedz },
  { metoda: "patch", sciezka: "/notes/{id}", zakresy: ["write"], opis: "Zmiana notatki z optymistyczna wspolbieznoscia: wymagany naglowek If-Match: <rev>. Brak kasowania; archived=true odklada do archiwum.", parametrySciezki: ["id"], cialo: NotatkaZmienSchema, odpowiedz: NotatkaOdpowiedz, ifMatch: true, bledy: { 409: "Nieaktualny rev; odpowiedz zawiera biezaca tresc.", 428: "Brak naglowka If-Match." } },
  { metoda: "post", sciezka: "/notes/{id}/attachments", zakresy: ["write"], opis: "Zalaczniki notatki (multipart: shot, interval, caption, capturedAt, chartState, origin). PNG, JPG, WebP, AVIF, HEIC -> WebP + miniatura. Tylko dopisywanie, do 8.", parametrySciezki: ["id"], rodzajCiala: "multipart", multipart: MULTIPART_ZALACZNIKI, odpowiedz: ZalacznikiOdpowiedz, status: 201, bledy: { 404: "Notatka nie istnieje.", 413: "Za duze cialo.", 422: "Plik odrzucony albo limit 8 zalacznikow." } },
  { metoda: "get", sciezka: "/notes/{id}/additions", zakresy: ["read"], opis: "Dopiski AI i mentora do notatki, z podpisem pochodzenia.", parametrySciezki: ["id"], odpowiedz: DopiskiListaOdpowiedz },
  { metoda: "post", sciezka: "/notes/{id}/additions", zakresy: ["write"], wymagaImportuDlaOrigin: true, opis: "Dopisek do notatki strategii albo karty setupu. AI: tradeId + cytat (quoteWordsId) lub evidence; mentor: mentorClaimId (zakres import). Regul nie zmienia.", parametrySciezki: ["id"], cialo: DopisekNotatkiSchema, odpowiedz: DopisekOdpowiedz, status: 201, bledy: { 200: "Powtorka tego samego dopisku: zwracany jest istniejacy wiersz.", 422: "Notatka zarzadzana (regula, hipoteza) albo nieznane odwolanie." } },

  { metoda: "get", sciezka: "/search", zakresy: ["read"], opis: "Wyszukiwanie w notatkach, slowach uzytkownika i trade'ach (bez polskich znakow, rozmyte).", query: SzukajQuery, odpowiedz: SzukajOdpowiedz },

  { metoda: "get", sciezka: "/rules", zakresy: ["read"], opis: "Reguly ze statusem wyliczonym z wersji i rulesVersion (numer zestawu). Filtr status i externalRef.", query: ReguliListaQuery, odpowiedz: ReguliListaOdpowiedz },
  { metoda: "post", sciezka: "/rules/proposals", zakresy: ["propose"], wymagaImportuDlaOrigin: true, opis: "Propozycja reguly lub nowej wersji. Zatwierdza wylacznie uzytkownik w aplikacji; zakresu approve nie ma.", cialo: PropozycjaReguly, odpowiedz: PropozycjaRegulyOdpowiedz, status: 201, bledy: { 200: "Taka tresc juz istnieje jako wersja o innym statusie.", 409: "Regula ma juz oczekujaca propozycje.", 422: "Hipoteza ponizej progu n (tylko propozycje AI)." } },

  { metoda: "get", sciezka: "/hypotheses", zakresy: ["read"], opis: "Hipotezy z n (n_imported + zamkniete trade'y podpiete), progiem i faza (zbieranie | do oceny). Filtr externalRef.", query: HipotezyListaQuery, odpowiedz: HipotezyListaOdpowiedz },
  { metoda: "post", sciezka: "/hypotheses", zakresy: ["write"], wymagaImportuDlaOrigin: true, opis: "Zaklada hipoteze (notatka kind=hypothesis + wiersz hypotheses, decyzja 'active').", cialo: HipotezaUtworzSchema, odpowiedz: HipotezaZapisOdpowiedz, status: 201 },
  { metoda: "get", sciezka: "/hypotheses/{code}/variants", zakresy: ["read"], opis: "Warianty testowane na hipotezie, ich licznik i ostrzezenie, ze wynik najlepszego z k wariantow jest zawyzony.", parametrySciezki: ["code"], odpowiedz: WariantyOdpowiedz, bledy: { 404: "Hipoteza nie istnieje." } },
  { metoda: "post", sciezka: "/hypotheses/{code}/variants", zakresy: ["write"], opis: "Rejestruje testowany wariant (SL, TP, okno). Licznik rosnie tylko dla nowego zestawu parametrow (skrot kanonicznego JSON-a); ten sam zestaw to 200.", parametrySciezki: ["code"], cialo: WariantUtworzSchema, odpowiedz: WariantZapisOdpowiedz, status: 201, bledy: { 200: "Wariant o tych parametrach juz jest zarejestrowany.", 404: "Hipoteza nie istnieje." } },

  { metoda: "get", sciezka: "/user-words", zakresy: ["read"], opis: "Slowa uzytkownika doslownie (text + sha256 + interpretacja AI osobno).", query: SlowaListaQuery, odpowiedz: SlowaListaOdpowiedz },
  { metoda: "post", sciezka: "/user-words", zakresy: ["write"], wymagaImportuDlaOrigin: true, opis: "Zapis slow uzytkownika bajt w bajt. Klient podaje sha256 z bajtow UTF-8; niezgodnosc = 400. Ponowne wyslanie tego samego wpisu jest idempotentne.", cialo: SlowaUtworzSchema, odpowiedz: SlowaOdpowiedz, status: 201, bledy: { 200: "Taki wpis juz istnieje (zwrocony bez duplikatu)." } },
  { metoda: "patch", sciezka: "/user-words/{id}", zakresy: ["write"], opis: "ZAWSZE 409: slowa uzytkownika sa niezmienne, poprawia je uzytkownik w aplikacji.", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/user-words/{id}", zakresy: ["write"], opis: "ZAWSZE 409: slowa uzytkownika sa niezmienne, poprawia je uzytkownik w aplikacji.", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/user-words/{id}/interpretation", zakresy: ["write"], opis: "Jedyna zmienna czesc slow: interpretacja AI, ustawiana raz. Poprawka uzytkownika idzie przez POST /profile/corrections.", parametrySciezki: ["id"], cialo: InterpretacjaSchema, odpowiedz: SlowaOdpowiedz, bledy: { 409: "Interpretacja jest juz ustawiona." } },

  { metoda: "post", sciezka: "/trade-plans", zakresy: ["write"], opis: "Zamraza plan PRZED wejsciem (setup, bias, wejscie, SL, TP, kontrakty, teza i uniewaznienie jako slowa uzytkownika). Zapis jednorazowy; ryzyko liczy computeTrade. Ten sam plan wyslany ponownie to 200.", cialo: PlanUtworzSchema, odpowiedz: PlanZapisOdpowiedz, status: 201, bledy: { 200: "Taki plan juz istnieje (bez duplikatu).", 409: "Trade ma juz plan albo setup jest wycofany.", 422: "Poziomy bez ryzyka, nieznane odwolanie albo plan nie pasuje do trade'a." } },
  { metoda: "get", sciezka: "/trade-plans", zakresy: ["read"], opis: "Zamrozone plany; filtry tradeId, accountId, day.", query: PlanyListaQuery, odpowiedz: PlanyListaOdpowiedz },
  { metoda: "get", sciezka: "/trade-plans/{id}", zakresy: ["read"], opis: "Plan z dopiskami, slowami uzytkownika (teza, uniewaznienie) i setupem.", parametrySciezki: ["id"], odpowiedz: PlanSzczegolyOdpowiedz, bledy: { 404: "Plan nie istnieje." } },
  { metoda: "patch", sciezka: "/trade-plans/{id}", zakresy: ["write"], opis: "ZAWSZE 409: zamrozony plan jest tylko do odczytu; zmiana to dopisek (POST .../addenda).", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "put", sciezka: "/trade-plans/{id}", zakresy: ["write"], opis: "ZAWSZE 409: zamrozony plan jest tylko do odczytu; zmiana to dopisek (POST .../addenda).", parametrySciezki: ["id"], odpowiedz: BladOdpowiedz, status: 409 },
  { metoda: "post", sciezka: "/trade-plans/{id}/addenda", zakresy: ["write"], opis: "Dopisek do zamrozonego planu z czasem i slowami uzytkownika (wordsId). Plan zostaje nietkniety.", parametrySciezki: ["id"], cialo: PlanDopisekSchema, odpowiedz: PlanDopisekOut, status: 201, bledy: { 200: "Powtorka tego samego dopisku (pole, wartosc, slowa): zwracany jest istniejacy wiersz.", 404: "Plan nie istnieje.", 422: "Slowa uzytkownika nie istnieja." } },
  { metoda: "post", sciezka: "/trade-plans/{id}/attach", zakresy: ["write"], opis: "Przypina plan do trade'a, gdy ten powstal po planie (jedyna zmiana planu dopuszczona przez baze). Konto, instrument, kierunek i dzien musza pasowac.", parametrySciezki: ["id"], cialo: PlanPrzypiecieSchema, odpowiedz: PlanSzczegolyOdpowiedz, bledy: { 404: "Plan nie istnieje.", 409: "Plan jest juz przypiety albo trade ma inny plan.", 422: "Plan nie pasuje do trade'a." } },

  { metoda: "get", sciezka: "/setups", zakresy: ["read"], opis: "Karty playbooka z obowiazujaca wersja i oczekujaca propozycja.", query: SetupyListaQuery, odpowiedz: SetupyListaOdpowiedz },
  { metoda: "post", sciezka: "/setups", zakresy: ["propose"], wymagaImportuDlaOrigin: true, opis: "Zaklada setup (karta + wersja 1 jako PROPOZYCJA). Zatwierdza uzytkownik w aplikacji.", cialo: SetupUtworzSchema, odpowiedz: SetupZapisOdpowiedz, status: 201, bledy: { 409: "Slug albo nazwa zajeta." } },
  { metoda: "get", sciezka: "/setups/{slug}", zakresy: ["read"], opis: "Karta setupu: wersje, przyklady A+ i anty-przyklady, statystyka z przedzialami osobno dla zrodel danych, status wg progow zadeklarowanych z gory i backtestToLive.", parametrySciezki: ["slug"], odpowiedz: SetupSzczegolyOdpowiedz, bledy: { 404: "Setup nie istnieje." } },
  { metoda: "post", sciezka: "/setups/{slug}/versions", zakresy: ["propose"], wymagaImportuDlaOrigin: true, opis: "Nowa wersja setupu jako PROPOZYCJA (jedna naraz). Zmiana progow statusu to nowa wersja.", parametrySciezki: ["slug"], cialo: SetupWersjaSchema, odpowiedz: SetupWersjaZapisOdpowiedz, status: 201, bledy: { 200: "Taka tresc juz istnieje.", 404: "Setup nie istnieje.", 409: "Setup ma oczekujaca propozycje, jest wycofany albo ta tresc odrzucono." } },

  { metoda: "get", sciezka: "/prop/presets", zakresy: ["read"], opis: "Presety regul prop firm jako dane: zrodlo, data odczytu, wiek w dniach i needsVerification.", query: PropPresetyQuery, odpowiedz: PropPresetyOdpowiedz },
  { metoda: "get", sciezka: "/prop/overview", zakresy: ["read"], opis: "Status wszystkich kont prop z regulami (bufory, ostrzezenia) oraz laczna ekspozycja NQ.", query: PropOverviewQuery, odpowiedz: PropOverviewOdpowiedz },
  { metoda: "get", sciezka: "/prop/accounts/{id}/rules", zakresy: ["read"], opis: "Reguly konta prop z datami obowiazywania.", parametrySciezki: ["id"], odpowiedz: PropRegulyListaOdpowiedz, bledy: { 404: "Konto nie istnieje.", 422: "To nie jest konto prop." } },
  { metoda: "post", sciezka: "/prop/accounts/{id}/rules", zakresy: ["write"], opis: "Przypina preset do konta od daty zakupu (validFrom) z dowolnymi nadpisaniami. Potwierdzenie z regulaminem robi uzytkownik w aplikacji.", parametrySciezki: ["id"], cialo: PropRegulyUtworzSchema, odpowiedz: PropRegulyOut, status: 201, bledy: { 404: "Konto nie istnieje.", 409: "Konto ma juz reguly od tej daty.", 422: "To nie konto prop, nieznany preset albo brak ddLockCents." } },
  { metoda: "get", sciezka: "/prop/accounts/{id}/status", zakresy: ["read"], opis: "Bufor do limitu dziennego i drawdownu w centach i w R, bufor »gdy trafi SL« (riskCents albo planId), ostrzezenia 50/75/90%, consistency, cel i kontrakty. Tylko ostrzezenia.", parametrySciezki: ["id"], query: PropStatusQuery, odpowiedz: PropStatusOdpowiedz, bledy: { 404: "Konto albo plan nie istnieje.", 422: "Konto bez regul obowiazujacych w tym dniu." } },
  { metoda: "get", sciezka: "/prop/accounts/{id}/ledger", zakresy: ["read"], opis: "Ksiega kosztow (evale, resety, aktywacje) i wyplat z realnym zwrotem netto.", parametrySciezki: ["id"], odpowiedz: PropKsiegaOdpowiedz, bledy: { 404: "Konto nie istnieje." } },
  { metoda: "post", sciezka: "/prop/accounts/{id}/ledger", zakresy: ["write"], opis: "Wpis do ksiegi (koszt ujemny, wyplata i zwrot dodatnie, w centach). Identyczny wpis z ostatniej minuty to ten sam wpis (200).", parametrySciezki: ["id"], cialo: PropKsiegaWpisSchema, odpowiedz: PropKsiegaZapisOdpowiedz, status: 201, bledy: { 200: "Identyczny wpis z ostatniej minuty.", 404: "Konto nie istnieje.", 422: "Znak kwoty nie pasuje do rodzaju." } },

  { metoda: "get", sciezka: "/reviews/weekly", zakresy: ["read"], opis: "Metryki procesowe tygodnia (3 najlepsze i 3 najgorsze wg procesu, rozklad A/B/C, koszt gry C, siatka 2x2, koszt lamania regul), zapisany przeglad i zobowiazanie poprzedniego tygodnia do rozliczenia.", query: PrzegladTygodniaQuery, odpowiedz: PrzegladTygodniaOdpowiedz },
  { metoda: "put", sciezka: "/reviews/weekly/{weekStart}", zakresy: ["write"], opis: "Zapis SZKICU przegladu tygodnia: draftMd z migawka liczb, wnioski i JEDNO zobowiazanie (slowa uzytkownika), rozliczenie poprzedniego. Zatwierdza tylko uzytkownik w aplikacji.", parametrySciezki: ["weekStart"], cialo: PrzegladTygodniaZapisSchema, odpowiedz: PrzegladZapisOdpowiedz, status: 200, bledy: { 201: "Utworzony nowy szkic.", 409: "Przeglad zatwierdzony albo zobowiazanie juz ustawione.", 422: "Nie poniedzialek, nieznane slowa albo brak zobowiazania do rozliczenia." } },

  { metoda: "get", sciezka: "/ai-suggestions", zakresy: ["read"], opis: "Kolejka potwierdzen AI z pochodzeniem, dowodem, poziomem pewnosci i n.", query: SugestieListaQuery, odpowiedz: SugestieListaOdpowiedz },
  { metoda: "post", sciezka: "/ai-suggestions", zakresy: ["propose"], opis: "Agent TWORZY sugestie (tag, powiazanie, przyklad setupu, ocena procesu, haslo slownika, wniosek dnia/tygodnia); zatwierdza tylko uzytkownik w aplikacji, a niezatwierdzona nie wchodzi do statystyk. Bez dowodu odrzucana. strategy_detail wchodzi od razu jako cofalny dopisek.", cialo: SugestiaUtworzSchema, odpowiedz: SugestiaZapisOdpowiedz, status: 201, bledy: { 200: "Taka sugestia juz istnieje.", 409: "Juz odrzucona albo juz zatwierdzona w danych.", 422: "Nieznane odwolanie." } },

  { metoda: "get", sciezka: "/chart-annotations", zakresy: ["read"], opis: "Twoje rysunki z wykresu z tekstem dokladnie jak go napisales.", query: AdnotacjeListaQuery, odpowiedz: AdnotacjeListaOdpowiedz },
  { metoda: "post", sciezka: "/chart-annotations", zakresy: ["write"], opis: "Paczka rysunkow uzytkownika; tekst bajt w bajt jako slowa uzytkownika (sha256 sprawdzany). Rysunki AI ([AI] ) odrzucane. Wynik per rysunek.", cialo: AdnotacjeZapisSchema, odpowiedz: AdnotacjeZapisOdpowiedz, status: 201, bledy: { 200: "Zadnego nowego rysunku.", 422: "Nieznany trade albo sesja." } },

  { metoda: "get", sciezka: "/profile", zakresy: ["read"], opis: "Slownik tradera, ostatnie poprawki interpretacji AI, miara odsetka poprawionych interpretacji w czasie i ile werdyktow AI uzytkownik zmienil.", odpowiedz: ProfilOdpowiedz },
  { metoda: "post", sciezka: "/profile/corrections", zakresy: ["write"], opis: "Poprawka interpretacji AI przez uzytkownika (»nie, chodzilo mi o…«): rejestr przed -> po, nowa interpretacja; nowe haslo slownika idzie do kolejki potwierdzen.", cialo: KorektaInterpretacjiSchema, odpowiedz: KorektaInterpretacjiOdpowiedz, status: 201, bledy: { 404: "Slowa nie istnieja.", 422: "Brak interpretacji do poprawienia albo brak zmiany." } },

  { metoda: "get", sciezka: "/strategy-gaps", zakresy: ["read"], opis: "Luki w strategii i kolejka »Do rozstrzygniecia« (sprzecznosci mentor kontra praktyka z cytatem i linkiem t=).", query: LukiListaQuery, odpowiedz: LukiListaOdpowiedz },
  { metoda: "post", sciezka: "/strategy-gaps", zakresy: ["propose"], wymagaImportuDlaOrigin: true, opis: "Zglasza pytanie o luke albo sprzecznosc. AI jej NIE rozstrzyga (odpowiada tylko uzytkownik w aplikacji: zostaje moj / biore mentora / oba z warunkiem).", cialo: LukaUtworzSchema, odpowiedz: LukaZapisOdpowiedz, status: 201, bledy: { 200: "To pytanie jest juz otwarte.", 409: "To pytanie rozstrzygnieto wczesniej.", 422: "Nieznane odwolanie." } },
  { metoda: "post", sciezka: "/strategy-gaps/{id}/ask", zakresy: ["write"], opis: "Rytual po sesji zadal pytanie uzytkownikowi (open -> asked). Odpowiedz jest tylko w aplikacji.", parametrySciezki: ["id"], odpowiedz: LukaZadanaOdpowiedz, bledy: { 404: "Pytanie nie istnieje.", 409: "Pytanie juz rozstrzygniete." } },

  { metoda: "get", sciezka: "/mentor/sources", zakresy: ["read", "import"], opis: "Filmy playlisty mentora ze statusem (zakres import).", query: MentorZrodlaListaQuery, odpowiedz: MentorZrodlaListaOdpowiedz },
  { metoda: "post", sciezka: "/mentor/sources", zakresy: ["write", "import"], opis: "Rejestruje film (idempotentnie po id filmu; tj mentor sync). Zakres import.", cialo: MentorZrodloSchema, odpowiedz: MentorZrodloZapisOdpowiedz, status: 201, bledy: { 200: "Film jest juz zarejestrowany." } },
  { metoda: "put", sciezka: "/mentor/sources/{videoId}", zakresy: ["write", "import"], opis: "Status przetwarzania filmu (processed, no_captions, error). Zakres import.", parametrySciezki: ["videoId"], cialo: MentorZrodloStatusSchema, odpowiedz: MentorZrodloOut, bledy: { 404: "Film nie jest zarejestrowany.", 422: "Brak opisu bledu albo zrodla transkrypcji." } },
  { metoda: "get", sciezka: "/mentor/claims", zakresy: ["read", "import"], opis: "Twierdzenia mentora z doslownym cytatem i linkiem t= (zakres import).", query: MentorTwierdzeniaListaQuery, odpowiedz: MentorTwierdzeniaListaOdpowiedz },
  { metoda: "post", sciezka: "/mentor/claims", zakresy: ["write", "import"], opis: "Paczka twierdzen z jednego filmu; cytat bajt w bajt (quoteSha256), idempotentnie po (film, skrot, t). Zakres import.", cialo: MentorTwierdzeniaZapisSchema, odpowiedz: MentorTwierdzeniaZapisOdpowiedz, status: 201, bledy: { 200: "Zadnego nowego twierdzenia.", 404: "Film nie jest zarejestrowany." } },
  { metoda: "patch", sciezka: "/mentor/claims/{id}", zakresy: ["write", "import"], opis: "Scalenie twierdzenia z notatka lub karta setupu (status merged). Cytat jest niezmienny; ocene zgodnosci z filmem robi uzytkownik. Zakres import.", parametrySciezki: ["id"], cialo: MentorTwierdzenieScalSchema, odpowiedz: MentorTwierdzenieOut, bledy: { 404: "Twierdzenie nie istnieje.", 409: "Twierdzenie ma ocene uzytkownika." } },

  { metoda: "post", sciezka: "/device/start", zakresy: null, opis: "Poczatek logowania kodem urzadzenia; zwraca user_code do przepisania w aplikacji. Bez tokenu, limit 10 na godzine na adres.", cialo: DeviceStartSchema, odpowiedz: DeviceStartOdpowiedz, bledy: { 403: "device_login_disabled (przelacznik DEVICE_LOGIN_DISABLED=1)", 429: "limit startow na adres albo too_many_pending (20 niezatwierdzonych zadan)" } },
  { metoda: "post", sciezka: "/device/token", zakresy: null, opis: "Odpytywanie o token co 5 s; token wraca dokladnie raz. Bez tokenu.", cialo: DeviceTokenSchema, odpowiedz: DeviceTokenOdpowiedz, bledy: { 400: "authorization_pending | expired_token | invalid_grant", 403: "access_denied (uzytkownik odrzucil)", 429: "slow_down (odpytywanie czesciej niz co 5 s) albo limit zapytan na adres" } },
];

/** Sciezka OpenAPI -> sciezka pliku trasy Next (`/notes/{id}` -> `notes/[id]`). */
export function katalogTrasy(sciezka: string): string {
  return sciezka.replace(/^\//, "").replace(/\{(\w+)\}/g, "[$1]");
}

function jsonSchema(schemat: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  const { $schema: _usun, ...reszta } = z.toJSONSchema(schemat, { io, unrepresentable: "any" }) as Record<string, unknown>;
  void _usun;
  return reszta;
}

function parametryQuery(schemat: z.ZodType): unknown[] {
  const js = jsonSchema(schemat, "input") as { properties?: Record<string, unknown>; required?: string[] };
  const wymagane = new Set(js.required ?? []);
  return Object.entries(js.properties ?? {}).map(([nazwa, s]) => ({
    name: nazwa,
    in: "query",
    required: wymagane.has(nazwa),
    schema: s,
  }));
}

export function zbudujOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const parametry: unknown[] = [
      ...(e.parametrySciezki ?? []).map((nazwa) => ({ name: nazwa, in: "path", required: true, schema: { type: "string" } })),
      ...(e.query ? parametryQuery(e.query) : []),
      ...(e.ifMatch ? [{ name: "If-Match", in: "header", required: true, description: "Numer rewizji (rev) z ostatniego odczytu notatki.", schema: { type: "string" } }] : []),
    ];
    const operacja: Record<string, unknown> = {
      operationId: `${e.metoda}${e.sciezka.replace(/[{}]/g, "").replace(/\/(\w)/g, (_m, c: string) => c.toUpperCase())}`,
      summary: e.opis,
      security: e.zakresy === null ? [] : [{ bearer: [] }],
      "x-scopes": e.zakresy ?? [],
      ...(e.wymagaImportuDlaOrigin ? { "x-import-scope-required-for-origins": ["vault-import", "mentor"] } : {}),
      parameters: parametry,
      responses: {
        [String(e.status ?? 200)]: {
          description: "Sukces",
          content: e.odpowiedz ? { "application/json": { schema: jsonSchema(e.odpowiedz, "output") } } : undefined,
        },
        ...Object.fromEntries(
          Object.entries(e.bledy ?? {}).map(([kod, opis]) => {
            // Kody 2xx w `bledy` (np. 200 przy powtorce, 201 przy utworzeniu) to SUKCES: ten sam schemat co odpowiedz glowna, nie schemat bledu.
            const sukces = Number(kod) < 300;
            const schemat = sukces ? (e.odpowiedz ? jsonSchema(e.odpowiedz, "output") : undefined) : jsonSchema(BladOdpowiedz, "output");
            return [kod, { description: opis, content: schemat ? { "application/json": { schema: schemat } } : undefined }];
          }),
        ),
        ...(e.zakresy === null ? {} : { "401": { description: "Brak, nieznany, uniewazniony albo wygasly token." }, "403": { description: "Token nie ma wymaganego zakresu." }, "429": { description: "Limit zapytan albo blokada." } }),
      },
    };
    if (e.cialo) {
      operacja.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(e.cialo, "input") } } };
    } else if (e.rodzajCiala === "multipart") {
      operacja.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: e.multipart ?? MULTIPART_ZRZUTY } },
      };
    }
    (paths[e.sciezka] ??= {})[e.metoda] = operacja;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Dziennik tradingowy API v2",
      version: WERSJA_KONTRAKTU,
      description:
        "Kontrakt generowany z schematow zod (src/lib/api-v2/contract). Autoryzacja: Authorization: Bearer tj_<prefiks>_<sekret>. Zakresy: read, write, propose oraz import (dodatkowy: tylko z nim wolno deklarowac origin vault-import i mentor; nadaje go wylacznie uzytkownik recznie w aplikacji, nigdy logowanie urzadzenia); zakresu zatwierdzania nie ma.",
    },
    servers: [{ url: "/api/v2" }],
    paths,
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "tj_<prefiks>_<sekret>" } } },
  };
}

/** Plik `docs/openapi-v2.json`: dokladnie te bajty, z ktorych liczy sie contractHash. */
let tekstZPamieci: string | undefined;
let hashZPamieci: string | undefined;

/** Rejestr jest stalym kodem, wiec tekst i skrot liczymy raz na proces (GET /meta wola contractHash przy kazdym zapytaniu). */
export function tekstOpenApi(): string {
  tekstZPamieci ??= `${JSON.stringify(zbudujOpenApi(), null, 2)}\n`;
  return tekstZPamieci;
}

export function contractHash(): string {
  hashZPamieci ??= createHash("sha256").update(tekstOpenApi(), "utf8").digest("hex");
  return hashZPamieci;
}
