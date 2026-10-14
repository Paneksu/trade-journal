import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";

/*
 * Kopia LOKALNEJ bazy: `npm run db:backup`. Prosty pg_dump do pliku SQL w
 * `.dane/kopie/` (katalog poza gitem).
 *
 * To NIE jest kopia produkcji. Produkcyjna baza ma harmonogram i reczny backup
 * w Coolify (docs/wdrozenie-coolify.md, sekcja 6) - skrypt celowo tam nie siega.
 *
 * BEZPIECZNIK: odmawia, gdy host z DATABASE_URL nie jest lokalny (localhost,
 * 127.0.0.0/8, ::1). Brak, pusty albo nieczytelny adres tez jest odmowa.
 * Skrypt tylko czyta baze, ale kopia produkcji zrobiona "przy okazji" na zlym
 * komputerze, z haslem w historii polecen, to wlasnie ten wypadek, ktorego
 * bezpiecznik ma pilnowac.
 *
 * Skad pg_dump: z PATH, a gdy go nie ma - z kontenera Dockera, ktory publikuje
 * port z DATABASE_URL (domyslnie `tj-postgres`, zmienna BACKUP_DOCKER_CONTAINER).
 */

function wczytajEnv(): void {
  // Jak Next: .env.local ma pierwszenstwo przed .env. `loadEnvFile` nie nadpisuje
  // zmiennych ustawionych juz w srodowisku.
  for (const plik of [".env.local", ".env"]) {
    if (existsSync(plik)) process.loadEnvFile(plik);
  }
}

function hostLokalny(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function ukryjHaslo(url: string): string {
  return url.replace(/:[^:@/]*@/, ":***@");
}

type Polaczenie = { host: string; port: string; user: string; password: string; db: string };

function rozbierz(url: string | undefined): Polaczenie {
  if (!url) {
    throw new Error("Brak DATABASE_URL. Ustaw ją w .env.local (adres lokalnej bazy, np. 127.0.0.1:55433).");
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL (${ukryjHaslo(url)}) nie jest poprawnym adresem postgresql://użytkownik:hasło@host:port/baza.`);
  }
  if (!hostLokalny(u.hostname)) {
    throw new Error(
      `ODMOWA: DATABASE_URL (${ukryjHaslo(url)}) wskazuje host „${u.hostname}”, który nie jest lokalny. ` +
        `Skrypt robi kopię tylko lokalnej bazy (localhost, 127.x.x.x, ::1). Kopię produkcji zrób w Coolify (Backups).`,
    );
  }
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    db: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

function uruchom(
  polecenie: string,
  argumenty: string[],
  env: NodeJS.ProcessEnv,
  doPliku: string,
): Promise<{ kod: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proces = spawn(polecenie, argumenty, { env, stdio: ["ignore", "pipe", "pipe"] });
    const plik = createWriteStream(doPliku);
    let stderr = "";
    proces.stdout.pipe(plik);
    proces.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proces.on("error", reject);
    proces.on("close", async (kod) => {
      plik.end();
      await once(plik, "close");
      resolve({ kod, stderr });
    });
  });
}

async function polecenieIstnieje(polecenie: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(polecenie, ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (kod) => resolve(kod === 0));
  });
}

async function portKontenera(kontener: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["port", kontener], { stdio: ["ignore", "pipe", "ignore"] });
    let wyjscie = "";
    p.stdout.on("data", (c: Buffer) => (wyjscie += c.toString()));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(wyjscie));
  });
}

async function main(): Promise<void> {
  wczytajEnv();
  const pol = rozbierz(process.env.DATABASE_URL);

  const katalog = path.resolve(".dane", "kopie");
  mkdirSync(katalog, { recursive: true });
  const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const plik = path.join(katalog, `${pol.db}-${stempel}.sql`);

  let wynik: { kod: number | null; stderr: string };
  if (await polecenieIstnieje("pg_dump")) {
    // Hasło przez zmienną środowiska, nie w argumentach (te widać na liście procesów).
    wynik = await uruchom(
      "pg_dump",
      ["--host", pol.host, "--port", pol.port, "--username", pol.user, "--dbname", pol.db, "--no-owner", "--no-privileges"],
      { ...process.env, PGPASSWORD: pol.password },
      plik,
    );
  } else {
    const kontener = process.env.BACKUP_DOCKER_CONTAINER || "tj-postgres";
    const porty = await portKontenera(kontener);
    if (!porty.includes(`:${pol.port}`)) {
      throw new Error(
        `Nie ma pg_dump w PATH, a kontener „${kontener}” nie publikuje portu ${pol.port} (docker port: „${porty.trim() || "brak odpowiedzi"}”). ` +
          `Zainstaluj klienta PostgreSQL albo ustaw BACKUP_DOCKER_CONTAINER na kontener bazy z DATABASE_URL.`,
      );
    }
    // Wewnątrz kontenera pg_dump łączy się przez gniazdo, więc hasło nie jest potrzebne.
    wynik = await uruchom(
      "docker",
      ["exec", kontener, "pg_dump", "--username", pol.user, "--dbname", pol.db, "--no-owner", "--no-privileges"],
      process.env,
      plik,
    );
  }

  if (wynik.kod !== 0) {
    rmSync(plik, { force: true });
    throw new Error(`pg_dump zakończył się kodem ${wynik.kod} i nie utworzył kopii bazy „${pol.db}”: ${wynik.stderr.trim() || "(brak komunikatu)"}`);
  }
  console.log(`Kopia bazy „${pol.db}” (${pol.host}:${pol.port}) zapisana: ${plik}`);
}

main().catch((blad: unknown) => {
  console.error(blad instanceof Error ? blad.message : blad);
  process.exit(1);
});
