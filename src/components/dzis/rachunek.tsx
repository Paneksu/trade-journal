"use client";

import Link from "next/link";

import { PobierzTeraz, type StanAutomatuUi } from "@/components/polaczenia/pobierz-teraz";
import { UzgodnioneLista } from "@/components/polaczenia/uzgodnione";
import type { UzgodnioneWiersz } from "@/lib/queries/broker";

/* Karta »Rachunek« na ekranie Dziś: ten sam »Pobierz teraz« co w Połączeniach i skrócona lista »Uzgodnione z rachunku«. */
export function RachunekDzis({ automat, wiersze, strefa }: { automat: StanAutomatuUi; wiersze: UzgodnioneWiersz[]; strefa: string }) {
  return (
    <div className="space-y-5">
      <PobierzTeraz automat={automat} sufiks="-dzis" />
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-karta text-text">Uzgodnione z rachunku</p>
        <UzgodnioneLista wiersze={wiersze} strefa={strefa} kompakt />
        <Link href="/prop/polaczenia#uzgodnione" className="przejscie inline-block text-meta text-muted underline underline-offset-2 hover:text-text">
          Wszystkie uzgodnienia
        </Link>
      </div>
    </div>
  );
}
