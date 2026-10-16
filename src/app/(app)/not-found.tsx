import { PustyStan, Strona } from "@/components/ui/v2";

/* Nie ma takiego zasobu (np. trade, konto, sesja o złym numerze), runda r2: komunikat po polsku i jedno działanie. */
export default function NieZnaleziono() {
  return (
    <Strona>
      <h1 className="mb-6 text-tytul font-medium tracking-tight text-text">Nie ma takiej strony</h1>
      <PustyStan tytul="Ten adres nie prowadzi do niczego w dzienniku." opis="Mógł zostać usunięty albo numer w adresie jest błędny." akcja={{ href: "/", etykieta: "Wróć do „Dziś”" }} />
    </Strona>
  );
}
