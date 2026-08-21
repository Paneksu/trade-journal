"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/base";
import { deleteTrade, removeScreenshot } from "@/lib/actions/trades";

/** Usuwanie wymaga potwierdzenia - kasuje takze zrzuty z dysku. */
export function DeleteTradeButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="danger"
      size="s"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Usunąć ten trade razem ze zrzutami? Tego nie da się cofnąć.")) return;
        startTransition(() => deleteTrade(id));
      }}
    >
      <Trash2 size={13} aria-hidden />
      {pending ? "Usuwam…" : "Usuń trade"}
    </Button>
  );
}

export function DeleteScreenshotButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Usunąć ten zrzut?")) return;
        startTransition(() => removeScreenshot(id));
      }}
      className="absolute right-2 top-2 rounded-[var(--radius-control)] border border-line-strong bg-bg/80 p-1.5 text-faint transition-colors duration-150 hover:text-loss"
      aria-label="Usuń zrzut"
    >
      <Trash2 size={13} aria-hidden />
    </button>
  );
}
