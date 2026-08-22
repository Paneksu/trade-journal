"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/base";
import { deleteTrade } from "@/lib/actions/trades";

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
