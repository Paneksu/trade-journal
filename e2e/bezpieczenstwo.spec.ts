import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { kodTotp } from "../src/lib/auth/totp";
import { wymagajLokalnych } from "./lokalne";

/*
 * Logowanie dwuskladnikowe (ADR-031) przeciw zywemu serwerowi z prawdziwa, LOKALNA
 * baza. Dowodem zapisu jest odczyt z bazy po zapisie, nie ekran sukcesu.
 *
 * Ten plik chodzi w osobnym projekcie `bezpieczenstwo`, OSTATNI: wlaczenie 2FA
 * podbija wersje sesji i uniewaznia ciasteczka z projektu `logowanie`. Po sobie
 * przywraca baze (2FA wylaczone, kody skasowane, haslo jak na starcie).
 *
 * Sekret TOTP generuje serwer przy wlaczaniu; test czyta go z pola "wpisz recznie"
 * (to samo, co robi uzytkownik bez skanera) i liczy kody tym samym kodem co serwer.
 * Ochrona przed powtorka kodu pozwala uzyc kodu z danego kroku 30 s tylko raz, a
 * test loguje sie kilka razy w ciagu sekund, wiec `przewin()` cofa zapamietany krok
 * w bazie - to symuluje uplyw czasu miedzy logowaniami. Powtorke sprawdzaja osobne
 * kroki testu BEZ przewijania.
 */

const DB_URL = process.env.DATABASE_URL ?? "";
const HASLO = process.env.E2E_PASSWORD ?? process.env.OWNER_PASSWORD ?? "";
const NOWE_HASLO = "Nowe-Haslo-E2E-1";

test.describe.configure({ mode: "serial" });

/* Osobny adres klienta dla tego pliku: licznik prob jest w pamieci serwera, a test blokady
   celowo go wyczerpuje. Serwer bierze ostatni wpis X-Forwarded-For (jak za Traefikiem). */
const ADRES = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
/* E2E_PROD=1: serwer to `next start` (NODE_ENV=production). Ciasteczka musza byc wtedy Secure,
   a zapytania niosa X-Forwarded-Proto jak za Traefikiem. W dev (http) Secure nie ma byc. */
const PROD = process.env.E2E_PROD === "1";
test.use({
  extraHTTPHeaders: { "x-forwarded-for": ADRES, ...(PROD ? { "x-forwarded-proto": "https" } : {}) },
});

test.describe("2FA TOTP", () => {
  let sql: ReturnType<typeof postgres>;
  let hashStartowy: string | null = null;
  let sekret = "";
  let kodyZapasowe: string[] = [];

  test.beforeAll(async () => {
    wymagajLokalnych(DB_URL, process.env.E2E_URL);
    if (!HASLO) throw new Error("Ustaw E2E_PASSWORD albo OWNER_PASSWORD.");
    sql = postgres(DB_URL, { max: 2 });
    const [s] = await sql`select password_hash, totp_enabled_at from settings where id = 1`;
    if (s.totp_enabled_at) throw new Error("Baza testowa ma już włączone 2FA - wyłącz je przed testem.");
    hashStartowy = s.password_hash;
  });

  test.afterAll(async () => {
    if (!sql) return;
    await sql`update settings set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null,
              password_hash = ${hashStartowy}, session_version = session_version + 1 where id = 1`;
    await sql`delete from auth_backup_codes`;
    await sql.end();
  });

  const przewin = () =>
    sql`update settings set totp_last_step = totp_last_step - 10 where id = 1 and totp_last_step is not null`;

  async function zalogujHaslem(page: Page, haslo = HASLO) {
    await page.goto("/login");
    await page.getByLabel("Hasło").fill(haslo);
    await page.getByRole("button", { name: "Wejdź" }).click();
  }

  /** Wysyla formularz kodu i czeka na odpowiedz serwera, zeby komunikat byl z TEJ proby, a nie z poprzedniej. */
  async function wpiszKod(page: Page, kod: string) {
    await page.locator("#kod").fill(kod);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/login")),
      page.getByRole("button", { name: "Zaloguj" }).click(),
    ]);
  }

  async function zalogujCalkowicie(page: Page) {
    await zalogujHaslem(page);
    await expect(page.getByRole("heading", { name: /Wpisz kod z aplikacji/ })).toBeVisible();
    await przewin();
    await wpiszKod(page, kodTotp(sekret));
    await expect(page).toHaveURL("/");
  }

  async function axe(page: Page) {
    const wynik = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const opis = wynik.violations.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} el.`);
    expect(opis, opis.join("\n")).toEqual([]);
  }

  async function ciasteczko(context: BrowserContext, nazwa: string) {
    return (await context.cookies()).find((c) => c.name === nazwa);
  }

  test("włączenie: hasło, QR, błędny kod odrzucony, poprawny włącza 2FA i pokazuje 10 kodów", async ({ page }) => {
    await zalogujHaslem(page);
    await expect(page).toHaveURL("/");
    await page.goto("/settings/security");
    await expect(page.getByText("Wyłączone", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await axe(page);

    // Złe hasło nie pokazuje kodu QR.
    await page.locator("#setup-haslo").fill("zle-haslo-123");
    await page.getByRole("button", { name: "Pokaż kod QR" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("Nieprawidłowe hasło");

    await page.locator("#setup-haslo").fill(HASLO);
    await page.getByRole("button", { name: "Pokaż kod QR" }).click();
    await expect(page.getByAltText("Kod QR do aplikacji uwierzytelniającej")).toBeVisible();
    sekret = (await page.getByTestId("totp-sekret").innerText()).trim();
    expect(sekret).toMatch(/^[A-Z2-7]{32}$/);

    // Przed potwierdzeniem w bazie nie ma sekretu.
    const [przed] = await sql`select totp_secret_enc, totp_enabled_at from settings where id = 1`;
    expect(przed.totp_secret_enc).toBeNull();
    expect(przed.totp_enabled_at).toBeNull();

    await page.locator("#setup-kod").fill("000000");
    await page.getByRole("button", { name: "Potwierdź i włącz 2FA" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("Nieprawidłowy kod");
    const [wciaz] = await sql`select totp_secret_enc from settings where id = 1`;
    expect(wciaz.totp_secret_enc).toBeNull();

    await page.locator("#setup-kod").fill(kodTotp(sekret));
    await page.getByRole("button", { name: "Potwierdź i włącz 2FA" }).click();
    await expect(page.getByText("2FA jest włączone.")).toBeVisible();

    kodyZapasowe = (await page.getByLabel("Kody zapasowe").getByRole("listitem").allInnerTexts()).map((k) =>
      k.trim(),
    );
    expect(kodyZapasowe).toHaveLength(10);
    for (const k of kodyZapasowe) expect(k).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    // Dowod z bazy: sekret zaszyfrowany, kody tylko jako HMAC, zdarzenie w dzienniku.
    const [po] = await sql`select totp_secret_enc, totp_enabled_at, totp_last_step from settings where id = 1`;
    expect(po.totp_secret_enc).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(po.totp_secret_enc).not.toContain(sekret);
    expect(po.totp_enabled_at).not.toBeNull();
    const wiersze = await sql`select code_hmac from auth_backup_codes`;
    expect(wiersze).toHaveLength(10);
    const surowe = kodyZapasowe.map((k) => k.replace("-", ""));
    for (const w of wiersze) expect(surowe).not.toContain(w.code_hmac);
    const [zd] = await sql`select count(*)::int as n from auth_events where kind = 'totp_enabled'`;
    expect(zd.n).toBeGreaterThan(0);
  });

  test("logowanie: samo hasło nie daje sesji, zły kod odrzucony, poprawny wpuszcza, ten sam kod drugi raz nie", async ({
    page,
    context,
    browser,
  }) => {
    await zalogujHaslem(page);
    await expect(page.getByRole("heading", { name: /Wpisz kod z aplikacji/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Po samym haśle nie ma sesji: chroniona strona odsyła na logowanie.
    expect(await ciasteczko(context, "tj_session")).toBeUndefined();
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /Wpisz kod z aplikacji/ })).toBeVisible();

    const krok2 = await ciasteczko(context, "tj_2fa");
    expect(krok2?.httpOnly).toBe(true);
    expect(krok2?.sameSite).toBe("Strict");
    expect(krok2?.secure).toBe(PROD);
    await axe(page);

    await wpiszKod(page, "000000");
    await expect(page.locator("p[role=alert]")).toContainText("Nieprawidłowy kod");

    await przewin();
    const kod = kodTotp(sekret);
    await wpiszKod(page, kod);
    // Po kodzie wracamy tam, dokad probowal wejsc uzytkownik (parametr wroc przezyl oba kroki).
    await expect(page).toHaveURL(/[/]settings[/]security$/);

    const sesja = await ciasteczko(context, "tj_session");
    expect(sesja?.httpOnly).toBe(true);
    expect(sesja?.sameSite).toBe("Strict");
    expect(sesja?.secure).toBe(PROD);
    expect(await ciasteczko(context, "tj_2fa")).toBeUndefined();

    // Ten sam kod w drugiej przeglądarce (bez przewijania): powtórka.
    const drugi = await browser.newContext({
      baseURL: process.env.E2E_URL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": ADRES },
    });
    const strona2 = await drugi.newPage();
    await zalogujHaslem(strona2);
    await wpiszKod(strona2, kod);
    await expect(strona2.locator("p[role=alert]")).toContainText("już użyty");
    await expect(strona2).toHaveURL(/\/login/);
    await drugi.close();
  });

  test("kod zapasowy loguje dokładnie raz (małe litery i myślnik dozwolone)", async ({ page }) => {
    const kod = kodyZapasowe[0];
    await zalogujHaslem(page);
    await wpiszKod(page, kod.toLowerCase());
    await expect(page).toHaveURL("/");

    const [uzyty] = await sql`select count(*)::int as n from auth_backup_codes where used_at is not null`;
    expect(uzyty.n).toBe(1);

    await page.context().clearCookies();
    await zalogujHaslem(page);
    await wpiszKod(page, kod);
    await expect(page.locator("p[role=alert]")).toContainText("Nieprawidłowy kod");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sudo: bez niego hasło, eksport i wyłączenie 2FA są zablokowane; z nim działają", async ({ page }) => {
    await zalogujCalkowicie(page);
    await page.goto("/settings/security");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Nieaktywny", { exact: true })).toBeVisible();
    await expect(page.getByText("Nieużytych kodów zapasowych:")).toContainText("9");
    await axe(page);

    // Zmiana hasła bez sudo: odmowa, hasło w bazie bez zmian.
    const [h0] = await sql`select password_hash from settings where id = 1`;
    await page.locator("#obecne").fill(HASLO);
    await page.locator("#nowe").fill(NOWE_HASLO);
    await page.locator("#powtorzone").fill(NOWE_HASLO);
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("wymaga potwierdzenia kodem");
    expect((await sql`select password_hash from settings where id = 1`)[0].password_hash).toBe(h0.password_hash);

    await expect(page.getByRole("button", { name: "Wyłącz 2FA" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Wygeneruj nowe kody zapasowe" })).toBeDisabled();

    // Pełny eksport bez sudo: odmowa z wyjaśnieniem.
    await page.goto("/settings/data");
    await page.getByRole("button", { name: "Pobierz kopię w JSON" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("tryb sudo");

    // Zły kod w sudo nie włącza trybu.
    await page.goto("/settings/security");
    await page.locator("#sudo-kod").fill("000000");
    await page.getByRole("button", { name: /Włącz tryb sudo/ }).click();
    await expect(page.locator("p[role=alert]")).toContainText("Nieprawidłowy kod");

    // Poprawny kod włącza sudo na 10 minut.
    await przewin();
    await page.locator("#sudo-kod").fill(kodTotp(sekret));
    await page.getByRole("button", { name: /Włącz tryb sudo/ }).click();
    await expect(page.getByText(/Aktywny do \d{2}:\d{2}/)).toBeVisible();
    const sudo = (await page.context().cookies()).find((c) => c.name === "tj_sudo");
    expect(sudo?.httpOnly).toBe(true);
    expect(sudo?.sameSite).toBe("Strict");
    expect(sudo?.secure).toBe(PROD);
    expect(sudo!.expires * 1000 - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(sudo!.expires * 1000 - Date.now()).toBeGreaterThan(9 * 60_000);

    // Eksport z sudo przechodzi: plik JSON ma dane i NIE ma sekretu ani skrótu hasła.
    await page.goto("/settings/data");
    const [pobranie] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Pobierz kopię w JSON" }).click(),
    ]);
    const sciezka = await pobranie.path();
    const tresc = await (await import("node:fs/promises")).readFile(sciezka, "utf8");
    expect(JSON.parse(tresc).wersja).toBe(1);
    expect(tresc).not.toContain("totp");
    expect(tresc).not.toContain("scrypt$");
  });

  test("sudo: zmiana hasła przechodzi, kończy sudo i wylogowuje inne sesje; nowe kody zapasowe unieważniają stare", async ({
    page,
    browser,
  }) => {
    await zalogujCalkowicie(page);
    const inna = await browser.newContext({
      baseURL: process.env.E2E_URL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": ADRES },
    });
    const innaStrona = await inna.newPage();
    await zalogujHaslem(innaStrona);
    await przewin();
    await wpiszKod(innaStrona, kodTotp(sekret));
    await expect(innaStrona).toHaveURL("/");

    await page.goto("/settings/security");
    await przewin();
    await page.locator("#sudo-kod").fill(kodTotp(sekret));
    await page.getByRole("button", { name: /Włącz tryb sudo/ }).click();
    await expect(page.getByText(/Aktywny do/)).toBeVisible();

    // Nowe kody zapasowe: pojawia się 10 kodów, stary kod przestaje działać.
    const [staryPrzed] = await sql`select count(*)::int as n from auth_backup_codes where used_at is null`;
    expect(staryPrzed.n).toBe(9);
    await page.getByRole("button", { name: "Wygeneruj nowe kody zapasowe" }).click();
    await expect(page.getByLabel("Kody zapasowe").getByRole("listitem")).toHaveCount(10);
    kodyZapasowe = (await page.getByLabel("Kody zapasowe").getByRole("listitem").allInnerTexts()).map((k) =>
      k.trim(),
    );
    const [naBazie] = await sql`select count(*)::int as n, count(distinct batch)::int as paczki from auth_backup_codes where used_at is null`;
    expect(naBazie).toEqual({ n: 10, paczki: 1 });

    // Zmiana hasła z sudo.
    const [h0] = await sql`select password_hash, session_version from settings where id = 1`;
    await page.locator("#obecne").fill(HASLO);
    await page.locator("#nowe").fill(NOWE_HASLO);
    await page.locator("#powtorzone").fill(NOWE_HASLO);
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page.getByText("Hasło zmienione.")).toBeVisible();
    const [h1] = await sql`select password_hash, session_version from settings where id = 1`;
    expect(h1.password_hash).not.toBe(h0.password_hash);
    expect(h1.session_version).toBe(h0.session_version + 1);

    // Druga przeglądarka jest wylogowana, ta ssama zostaje zalogowana, a sudo się skończyło.
    await innaStrona.goto("/trades");
    await expect(innaStrona).toHaveURL(/\/login/);
    await inna.close();
    await page.goto("/settings/security");
    await expect(page.getByText("Nieaktywny", { exact: true })).toBeVisible();

    // Przywracamy hasło wyjściowe (znów przez sudo: wersja sesji poszła w górę).
    await przewin();
    await page.locator("#sudo-kod").fill(kodTotp(sekret));
    await page.getByRole("button", { name: /Włącz tryb sudo/ }).click();
    await expect(page.getByText(/Aktywny do/)).toBeVisible();
    await page.locator("#obecne").fill(NOWE_HASLO);
    await page.locator("#nowe").fill(HASLO);
    await page.locator("#powtorzone").fill(HASLO);
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page.getByText("Hasło zmienione.")).toBeVisible();
  });

  test("blokada po 8 błędach obejmuje kod TOTP, także poprawny kod w czasie blokady", async ({ browser }) => {
    // Własny adres klienta: licznik jest w pamięci serwera i ma zacząć od zera.
    const adresBlokady = `192.0.2.${1 + Math.floor(Math.random() * 250)}`;
    const kontekst = await browser.newContext({
      baseURL: process.env.E2E_URL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": adresBlokady },
    });
    const page = await kontekst.newPage();
    await zalogujHaslem(page);
    await expect(page.getByRole("heading", { name: /Wpisz kod z aplikacji/ })).toBeVisible();

    const alert = page.locator("p[role=alert]");
    for (let i = 1; i <= 8; i++) {
      await wpiszKod(page, "000000");
      await expect(alert, `próba ${i}`).toHaveText("Nieprawidłowy kod.");
    }
    // Dziewiąta próba, nawet z poprawnym kodem, jest odrzucona przez blokadę.
    await przewin();
    await wpiszKod(page, kodTotp(sekret));
    await expect(alert).toHaveText(/Za dużo prób[.] Spróbuj ponownie za [0-9]+ min[.]/);
    await expect(page).toHaveURL(/[/]login/);
    expect(await ciasteczko(kontekst, "tj_session")).toBeUndefined();

    const [n] = await sql`select count(*)::int as n from auth_events where kind = 'totp_fail' and ip = ${adresBlokady}`;
    expect(n.n).toBe(8);
    await kontekst.close();
  });

  test("wyłączenie 2FA z sudo czyści sekret i kody, a dziennik zdarzeń pokazuje cały przebieg", async ({
    browser,
  }) => {
    // Inny adres klienta niż test blokady, który właśnie zamknął poprzedni.
    const kontekst = await browser.newContext({
      baseURL: process.env.E2E_URL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` },
    });
    const page = await kontekst.newPage();
    await zalogujCalkowicie(page);
    await page.goto("/settings/security");
    await przewin();
    await page.locator("#sudo-kod").fill(kodTotp(sekret));
    await page.getByRole("button", { name: /Włącz tryb sudo/ }).click();
    await expect(page.getByText(/Aktywny do/)).toBeVisible();

    await page.getByRole("button", { name: "Wyłącz 2FA" }).click();
    await expect(page.getByText("Wyłączone", { exact: true })).toBeVisible();

    const [s] = await sql`select totp_secret_enc, totp_enabled_at, totp_last_step from settings where id = 1`;
    expect(s).toEqual({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: null });
    const [k] = await sql`select count(*)::int as n from auth_backup_codes`;
    expect(k.n).toBe(0);

    const tabela = page.getByRole("table");
    for (const wpis of ["Włączono 2FA", "Tryb sudo", "Wyłączono 2FA", "Zmieniono hasło", "Błędny kod", "Zalogowano"]) {
      await expect(tabela.getByText(wpis).first()).toBeVisible();
    }

    // Po wyłączeniu logowanie znów jest samym hasłem.
    const czysty = await browser.newContext({
      baseURL: process.env.E2E_URL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` },
    });
    const p2 = await czysty.newPage();
    await zalogujHaslem(p2);
    await expect(p2).toHaveURL("/");
    await czysty.close();
    await kontekst.close();
  });
});
