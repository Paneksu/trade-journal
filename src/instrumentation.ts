/**
 * Hak uruchamiany raz, przy starcie serwera.
 *
 * Zaklada dane poczatkowe, ale tylko w zupelnie swiezej bazie: hasło z
 * OWNER_PASSWORD, konto, katalog kontraktow, tagi i przykladowe pola wlasne.
 * Dzieki temu wdrozenie na czystej bazie nie wymaga zadnego recznego kroku,
 * a kolejne restarty niczego nie ruszaja - w szczegolnosci nie wskrzeszaja
 * instrumentow ani tagow, ktore uzytkownik skasowal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Klucz 2FA sprawdzamy przy starcie, zeby brak zmiennej wyszedl w logach wdrozenia,
  // a nie dopiero wtedy, gdy ktos probuje wlaczyc 2FA albo sie zalogowac kodem.
  if (process.env.NODE_ENV === "production") {
    const { wczytajKluczGlowny } = await import("@/lib/auth/totp");
    try {
      wczytajKluczGlowny();
    } catch (e) {
      console.error(`[auth] 2FA niedostępne: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    const [{ db }, { seedIfEmpty }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/db/seed-core"),
    ]);

    const done = await seedIfEmpty(db, (message) => console.log(`Dane początkowe: ${message}`));
    if (done) console.log("Dane początkowe: gotowe");
  } catch (error) {
    // Blad seeda nie moze wywrocic serwera - aplikacja i tak powie na ekranie
    // logowania, ze baza nie ma ustawien.
    console.error("Dane początkowe: nie udało się przygotować bazy", error);
  }
}
