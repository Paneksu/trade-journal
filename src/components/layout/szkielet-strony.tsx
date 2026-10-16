import { Strona, Szkielet } from "@/components/ui/v2";

/* Szkielet ekranu (runda r2): szkielet w układzie strony v2 (nagłówek, liczba, 3 karty,
   lista), żeby przejście między ekranami nie pokazywało pustki. */
export function SzkieletStrony() {
  return (
    <Strona>
      <div role="status" aria-live="polite" className="space-y-8">
        <span className="sr-only">Wczytuję…</span>
        <div className="space-y-2">
          <Szkielet className="h-8 w-48" />
          <Szkielet className="h-4 w-72 max-w-full" />
        </div>
        <div className="space-y-2">
          <Szkielet className="h-4 w-24" />
          <Szkielet className="h-9 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Szkielet className="h-32" />
          <Szkielet className="h-32" />
          <Szkielet className="h-32" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Szkielet key={i} className="h-12" />
          ))}
        </div>
      </div>
    </Strona>
  );
}
