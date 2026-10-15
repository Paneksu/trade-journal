import { EdytorNotatki } from "@/components/mozg/edytor";
import { NaglowekStrony } from "@/components/ui/v2";
import { requireSession } from "@/lib/auth/guard";
import { tytulyNotatek } from "@/lib/queries/mozg";

export const metadata = { title: "Nowa notatka — Mózg" };

/* Nowa notatka (UI v2, wzór 9). Reguły, hipotezy i setupy nie powstają tutaj: mają własne ścieżki z wersjami. */
export default async function NowaNotatkaPage() {
  await requireSession();
  const tytuly = await tytulyNotatek();
  return (
    <div className="mx-auto w-full max-w-[920px] space-y-6">
      <NaglowekStrony tytul="Nowa notatka" podtytul="Linki do innych notatek: wpisz [[ i wybierz tytuł." />
      <EdytorNotatki notatka={null} tytuly={tytuly} anuluj="/mozg" />
    </div>
  );
}
