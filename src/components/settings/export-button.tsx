"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button, ErrorMessage } from "@/components/ui/base";
import { exportAll } from "@/lib/actions/data";

/** Eksport calej bazy do pliku JSON - kopia niezalezna od Postgresa. */
export function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const json = await exportAll();
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `dziennik-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
          } catch {
            setError("Nie udało się przygotować pliku. Spróbuj ponownie.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={15} aria-hidden />
        {busy ? "Przygotowuję…" : "Pobierz kopię w JSON"}
      </Button>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
