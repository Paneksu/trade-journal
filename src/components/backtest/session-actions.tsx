"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/base";
import { deleteBacktestSession } from "@/lib/actions/strategies";

/** Usuniecie sesji kasuje takze jej trade'y - to symulacja, nie historia konta. */
export function DeleteSessionButton({ id }: { id: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="danger"
      size="s"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            "Usunąć sesję razem ze wszystkimi jej trade'ami? Tego nie da się cofnąć.",
          )
        ) {
          return;
        }
        startTransition(() => deleteBacktestSession(id));
      }}
    >
      <Trash2 size={13} aria-hidden />
      {pending ? "Usuwam…" : "Usuń sesję"}
    </Button>
  );
}
