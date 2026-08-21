import { FieldForm, NewField } from "@/components/settings/forms";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { TYPE_NAMES } from "@/lib/fields/fields";
import { getFields } from "@/lib/queries/dictionaries";

export const metadata = { title: "Pola własne — Dziennik tradingowy" };

export default async function FieldsSettingsPage() {
  await requireSession();
  const fields = await getFields();

  return (
    <div className="space-y-4">
      <Panel
        title="Pola własne"
        description="Tu decydujesz, jakimi kolumnami opisujesz trade. Pole od razu pojawia się w formularzu, w filtrach, w tabeli i jako wymiar statystyk."
      >
        <NewField />
      </Panel>

      {fields.map((f) => (
        <Panel
          key={f.id}
          title={f.label}
          description={[
            TYPE_NAMES[f.type],
            f.options.length > 0 ? `${f.options.length} wartości` : null,
            f.required ? "wymagane" : null,
            f.inTable ? "w tabeli" : null,
            f.inStats ? "w statystykach" : null,
            f.archived ? "ukryte" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <FieldForm values={f} />
        </Panel>
      ))}
    </div>
  );
}
