import Link from "next/link";
import type { MealAttendance, MealWithDishes, PurchaseListRow, ScaledIngredient, SupplyTaskRow } from "@/lib/kitchen";
import { CARD, LABEL, Tag } from "@/components/ui/kit";
import { EmptyState, dayHeading, formatAmount } from "./parts";
import { HeadCountWorking } from "./MealForm";

function purchaseLine(row: PurchaseListRow): string {
  const measure = [formatAmount(row.amount), row.unit ?? ""].filter(Boolean).join(" ");
  if (row.amount === null) return `${row.name} — to taste`;
  return row.unmeasured ? `${measure} ${row.name}, plus some to taste` : `${measure} ${row.name}`;
}

export default function ShoppingTab({
  meals,
  purchases,
  scaled,
  supplyTasks,
  headCounts,
  attendance,
}: {
  meals: MealWithDishes[];
  purchases: Map<string, PurchaseListRow[]>;
  scaled: Map<string, ScaledIngredient[]>;
  supplyTasks: SupplyTaskRow[];
  headCounts: Map<string, number | null>;
  attendance: Map<string, MealAttendance>;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Shopping list</h2>
          <p className="mt-0.5 max-w-[640px] text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Each recipe scaled to the meal&rsquo;s headcount, added up by ingredient name. &ldquo;Flour&rdquo; and
            &ldquo;plain flour&rdquo; stay separate, so glance for near-duplicates.
          </p>
        </div>
        {meals.length === 0 ? (
          <EmptyState>Add meals with a headcount and dishes with ingredients, and the list is worked out here.</EmptyState>
        ) : (
          meals.map((meal) => {
            const rows = purchases.get(meal.id) ?? [];
            const items = scaled.get(meal.id) ?? [];
            const headCount = headCounts.get(meal.id) ?? null;
            return (
              <div key={meal.id} className={CARD}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{meal.label}</h3>
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{dayHeading(meal.date)}</span>
                  <Tag tone={headCount ? "accent" : "neutral"}>{headCount ? `${headCount} eating` : "no headcount"}</Tag>
                  {meal.headCountSource === "participation" && <Tag tone="accent2">from arrivals</Tag>}
                </div>
                {meal.headCountSource === "participation" && (
                  <div className="mt-1">
                    <HeadCountWorking attendance={attendance.get(meal.id)!} guests={meal.guests} />
                  </div>
                )}
                {!headCount ? (
                  <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                    Add a headcount to this meal (Menu tab → Edit meal), or set it to work out from who&rsquo;s coming, to get a
                    shopping list. Without one, recipes stay at their own scale.
                  </p>
                ) : rows.length === 0 ? (
                  <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">No ingredients on this meal&rsquo;s dishes yet.</p>
                ) : (
                  <>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[length:var(--text-body)] text-[var(--text)]">
                      {rows.map((row) => (
                        <li key={row.name}>{purchaseLine(row)}</li>
                      ))}
                    </ul>
                    {items.some((i) => i.scaled) && (
                      <details className="mt-2 text-[length:var(--text-meta)]">
                        <summary className="cursor-pointer text-[var(--accent-1)]">How each dish was scaled</summary>
                        <ul className="mt-1.5 space-y-0.5 text-[var(--text-muted)]">
                          {items
                            .filter((i) => i.scaled)
                            .map((i, n) => (
                              <li key={n}>
                                {i.dishName}: {i.name} {formatAmount(i.storedAmount)} → {formatAmount(i.scaledAmount)} {i.unit ?? ""} (×{i.factor})
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </section>

      {supplyTasks.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Ordering &amp; equipment</h2>
            <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Open tasks in this scope tagged as supply work, with their resources.
            </p>
          </div>
          {supplyTasks.map((t) => (
            <div key={t.id} className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/tasks/${t.id}`} className="text-[length:var(--text-body)] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {t.title}
                </Link>
                <div className="flex gap-1">
                  {t.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
              </div>
              {t.resources.length > 0 && (
                <>
                  <span className={`${LABEL} mt-2 block`}>Resources</span>
                  <ul className="mt-1 space-y-0.5 text-[length:var(--text-body)]">
                    {t.resources.map((r) => (
                      <li key={r.id}>
                        <a href={r.url} className="text-[var(--accent-1)] hover:underline" target="_blank" rel="noreferrer">
                          {r.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
