import { NewTag, NewTagCategory, TagCategoryForm, TagForm } from "@/components/settings/forms";
import { Panel } from "@/components/ui/base";
import { requireSession } from "@/lib/auth/guard";
import { getTagCategories, getTags } from "@/lib/queries/dictionaries";

export const metadata = { title: "Tagi — Dziennik tradingowy" };

export default async function TagsSettingsPage() {
  await requireSession();
  const [categories, tags] = await Promise.all([getTagCategories(), getTags()]);

  return (
    <div className="space-y-4">
      <Panel
        title="Tagi"
        description="Kategorie i wartości definiujesz sam. Każda kategoria staje się osobnym wymiarem w statystykach i w Edge Finderze."
      >
        <div className="flex flex-wrap gap-2 p-4 pb-0">
          <NewTagCategory />
          {categories.length > 0 && <NewTag categories={categories} />}
        </div>
      </Panel>

      {categories.map((c) => {
        const inCategory = tags.filter((t) => t.categoryId === c.id);
        return (
          <Panel
            key={c.id}
            title={c.name}
            description={c.description ?? `${inCategory.length} tagów`}
          >
            <TagCategoryForm
              values={{
                id: c.id,
                name: c.name,
                key: c.key,
                description: c.description,
                sortOrder: c.sortOrder,
              }}
            />
            <div className="divide-y divide-line border-t border-line">
              {inCategory.map((t) => (
                <TagForm
                  key={t.id}
                  categories={categories}
                  values={{
                    id: t.id,
                    categoryId: t.categoryId,
                    name: t.name,
                    color: t.color,
                    archived: t.archived,
                  }}
                />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
