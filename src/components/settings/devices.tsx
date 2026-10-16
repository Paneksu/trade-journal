"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { Button, Checkbox, ErrorMessage, Input, Label, SuccessMessage } from "@/components/ui/base";
import { type Potwierdzenie, odrzucOczekujace, uniewaznUrzadzenie, utworzTokenBrokeraAkcja, utworzTokenImportuAkcja, type TokenImportuState, zatwierdzUrzadzenie, znajdzKod, type PolaczState } from "@/lib/actions/devices";
import { czyInnyAdres } from "@/lib/api-v2/adres";
import { dateTime } from "@/lib/format";

/* Minimalny ekran urzadzen (faza 2); pelny interfejs przyjdzie w fazie 5. */

const OPISY_ZAKRESOW: Record<string, string> = {
  read: "odczyt: trade'y, notatki, reguły, wyszukiwanie",
  write: "zapis: trade'y, zrzuty, notatki, słowa użytkownika, dzień",
  propose: "propozycje: nowe reguły (zatwierdzasz je Ty, po jednej)",
};

function Przycisk({ etykieta, wariant = "primary" }: { etykieta: string; wariant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={wariant} size="m" disabled={pending}>
      {pending ? "Chwila…" : etykieta}
    </Button>
  );
}

export function PolaczUrzadzenie() {
  const [znaleziony, znajdz] = useActionState<PolaczState, FormData>(znajdzKod, {});
  const [decyzja, decyduj] = useActionState<PolaczState, FormData>(zatwierdzUrzadzenie, {});

  if (decyzja.ok) {
    return <SuccessMessage>{decyzja.wynik}</SuccessMessage>;
  }

  if (znaleziony.kod) {
    const k = znaleziony.kod;
    const innyAdres = czyInnyAdres(k.clientIp, znaleziony.ipPrzegladarki);
    return (
      <form action={decyduj} className="space-y-4 p-4">
        <input type="hidden" name="id" value={k.id} />
        <div className="space-y-1 text-sm">
          <p>
            Urządzenie nazwane <strong className="text-text">{k.clientName}</strong> prosi o dostęp do dziennika.
          </p>
          <p className="text-xs text-faint">Nazwę podało samo urządzenie; nie jest sprawdzona i każdy może wpisać dowolną.</p>
          <p className="text-muted">
            Kod {k.userCode} · adres, z którego przyszło żądanie: {k.clientIp ?? "nieznany"} · ważny do{" "}
            {dateTime(k.expiresAt)}
          </p>
          {innyAdres && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-loss/40 bg-loss-dim px-3 py-2 text-loss">
              Uwaga: żądanie przyszło z adresu {k.clientIp}, a Ty jesteś połączony z adresu {znaleziony.ipPrzegladarki}. Jeśli
              terminal z `tj login` nie jest na tym samym łączu, co ta przeglądarka, a nie masz VPN, odrzuć to żądanie.
            </p>
          )}
          <p className="text-faint">Zatwierdź tylko wtedy, gdy to Ty właśnie uruchomiłeś `tj login` i kod zgadza się z terminalem.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-text">Zakresy (możesz odznaczyć)</legend>
          {k.requestedScopes.map((s) => (
            <Checkbox key={s} name="scope" value={s} defaultChecked label={s} hint={OPISY_ZAKRESOW[s]} />
          ))}
        </fieldset>
        {(decyzja.potwierdzenie ?? znaleziony.potwierdzenie) === "haslo" && (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="haslo" hint="2FA jest wyłączone, więc nadanie dostępu potwierdzasz hasłem (włącz 2FA w Ustawienia → Bezpieczeństwo)">
              Hasło
            </Label>
            <Input id="haslo" name="haslo" type="password" autoComplete="current-password" />
          </div>
        )}
        {(decyzja.potwierdzenie ?? znaleziony.potwierdzenie) === "sudo" && (
          <p role="status" className="text-xs text-muted">
            Zatwierdzenie wymaga trybu sudo (kod z aplikacji albo kod zapasowy). Wejdź w{" "}
            <a href="/settings/security" className="text-accent underline">Ustawienia → Bezpieczeństwo</a>, potem wróć i zatwierdź. Odrzucenie nie wymaga sudo.
          </p>
        )}
        {decyzja.error && <ErrorMessage>{decyzja.error}</ErrorMessage>}
        <div className="flex gap-2">
          <Button type="submit" name="decyzja" value="zatwierdz" variant="primary" size="m">
            Zatwierdź urządzenie
          </Button>
          <Button type="submit" name="decyzja" value="odrzuc" variant="danger" size="m">
            Odrzuć
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={znajdz} className="space-y-3 p-4">
      <Label htmlFor="kod" hint="Przepisz kod z terminala. Nie ma linku z gotowym kodem: to utrudnia oszustwo.">
        Kod z terminala
      </Label>
      <Input
        id="kod"
        name="kod"
        placeholder="BCDF-GHJK"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        required
        className="max-w-xs font-mono uppercase tracking-widest"
      />
      {znaleziony.error && <ErrorMessage>{znaleziony.error}</ErrorMessage>}
      <Przycisk etykieta="Dalej" />
    </form>
  );
}

export function UniewaznPrzycisk({ id, nazwa }: { id: number; nazwa: string }) {
  const [pending, start] = useTransition();
  const [blad, ustawBlad] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="danger"
        size="s"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Unieważnić token „${nazwa}”? Urządzenie straci dostęp natychmiast.`)) return;
          start(async () => {
            const w = await uniewaznUrzadzenie(id);
            ustawBlad(w.error ?? null);
          });
        }}
      >
        Unieważnij
      </Button>
      {blad && <span className="text-xs text-loss">{blad}</span>}
    </span>
  );
}

export function OdrzucOczekujacePrzycisk() {
  const [pending, start] = useTransition();
  const [info, ustawInfo] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="danger"
        size="s"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Odrzucić wszystkie oczekujące żądania logowania urządzeń? Tak zrób, gdy żadnego z nich nie uruchomiłeś.")) return;
          start(async () => {
            const w = await odrzucOczekujace();
            ustawInfo(w.error ?? `Odrzucono: ${w.odrzucono ?? 0}`);
          });
        }}
      >
        Odrzuć wszystkie oczekujące
      </Button>
      {info && <span className="text-xs text-muted">{info}</span>}
    </span>
  );
}

export function TokenImportuPrzycisk({ potwierdzenie }: { potwierdzenie: Potwierdzenie }) {
  const [pending, start] = useTransition();
  const [stan, ustawStan] = useState<TokenImportuState>({});
  const [haslo, ustawHaslo] = useState("");
  const wymagane = stan.potwierdzenie ?? potwierdzenie;
  return (
    <div className="space-y-2">
      {wymagane === "haslo" && (
        <div className="max-w-xs">
          <Label htmlFor="haslo-importu" hint="2FA jest wyłączone: potwierdź hasłem">Hasło</Label>
          <Input id="haslo-importu" type="password" autoComplete="current-password" value={haslo} onChange={(e) => ustawHaslo(e.target.value)} />
        </div>
      )}
      {wymagane === "sudo" && (
        <p className="text-xs text-muted">
          Tworzenie tokenu importu wymaga trybu sudo: <a href="/settings/security" className="text-accent underline">Ustawienia → Bezpieczeństwo</a>.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="s"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Utworzyć token importu? Ma zakres »import« (pochodzenie vault-import i mentor), ważny 24 godziny. Pokażę go tylko raz.")) return;
          start(async () => {
            const w = await utworzTokenImportuAkcja(haslo);
            ustawHaslo("");
            ustawStan(w);
          });
        }}
      >
        Utwórz token importu (24 h)
      </Button>
      {stan.error && <ErrorMessage>{stan.error}</ErrorMessage>}
      {stan.token && (
        <div className="space-y-1 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 p-3 text-sm">
          <p className="text-text">Skopiuj token teraz. Nie pokażę go drugi raz.</p>
          <code className="block break-all font-mono text-xs text-text" data-testid="token-importu">{stan.token}</code>
          <p className="text-xs text-faint">Ważny do {dateTime(stan.expiresAt)}. Zakresy: read, write, propose, import.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Token automatu eksportów z rachunku (`import_broker`, ADR-034 pkt 3). Jedyny zakres: wysyłanie plików z folderu Pobrane.
 * Wydawanie jak token importu: sudo albo hasło przy wyłączonym 2FA; token pokazujemy jeden raz.
 */
export function TokenBrokeraPrzycisk({ potwierdzenie }: { potwierdzenie: Potwierdzenie }) {
  const [pending, start] = useTransition();
  const [stan, ustawStan] = useState<TokenImportuState>({});
  const [haslo, ustawHaslo] = useState("");
  const [kopia, ustawKopie] = useState<string | null>(null);
  const wymagane = stan.potwierdzenie ?? potwierdzenie;

  const kopiuj = async () => {
    try {
      await navigator.clipboard.writeText(stan.token ?? "");
      ustawKopie("Skopiowano do schowka.");
    } catch {
      ustawKopie("Nie udało się skopiować. Zaznacz token i skopiuj ręcznie.");
    }
  };

  return (
    <div className="space-y-2">
      {wymagane === "haslo" && (
        <div className="max-w-xs">
          <Label htmlFor="haslo-brokera" hint="2FA jest wyłączone: potwierdź hasłem">Hasło</Label>
          <Input id="haslo-brokera" data-testid="token-brokera-haslo" type="password" autoComplete="current-password" value={haslo} onChange={(e) => ustawHaslo(e.target.value)} />
        </div>
      )}
      {wymagane === "sudo" && (
        <p role="status" className="text-xs text-muted">
          Wydanie tokenu automatu wymaga trybu sudo: <a href="/settings/security" className="text-accent underline">Ustawienia → Bezpieczeństwo</a>.
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="m"
        data-testid="token-brokera-wydaj"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Wydać token automatu eksportów? Służy tylko do wysyłania plików z folderu Pobrane, ważny 90 dni. Pokażę go tylko raz.")) return;
          start(async () => {
            const w = await utworzTokenBrokeraAkcja(haslo);
            ustawHaslo("");
            ustawKopie(null);
            ustawStan(w);
          });
        }}
      >
        {pending ? "Chwila…" : "Wydaj token"}
      </Button>
      <div role="status" aria-live="polite">
        {stan.error && <ErrorMessage>{stan.error}</ErrorMessage>}
        {stan.token && (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-line-strong bg-surface-2 p-3 text-sm" data-testid="token-brokera-pokaz">
            <p className="text-text">Skopiuj token teraz. Nie pokażę go drugi raz.</p>
            <code className="block break-all font-mono text-xs text-text" data-testid="token-brokera">{stan.token}</code>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="m" data-testid="token-brokera-kopiuj" onClick={kopiuj}>
                Kopiuj token
              </Button>
              {kopia && <span className="text-xs text-muted">{kopia}</span>}
            </div>
            <p className="text-xs text-faint">Ważny do {dateTime(stan.expiresAt)}. W terminalu wpisz <code className="font-mono">tj watch-exports login</code> i wklej token.</p>
          </div>
        )}
      </div>
    </div>
  );
}
