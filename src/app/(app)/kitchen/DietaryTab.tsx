import Link from "next/link";
import type { KitchenSignal } from "@/db/schema";
import type { DietaryOverview, MealConstraintPanel, MealWithDishes, SignalSummary } from "@/lib/kitchen";
import { CARD, LABEL, Tag } from "@/components/ui/kit";
import { MealDietary } from "./MenuTab";
import { EmptyState } from "./parts";

const SETTINGS = "/settings?tab=profile-privacy#kitchen-questions";

const TITLES: Record<KitchenSignal, string> = {
  allergy: "Allergies",
  intolerance: "Intolerances",
  dislike: "Dislikes",
};

const BLURBS: Record<KitchenSignal, string> = {
  allergy: "A reaction that could be serious. Checked against each dish's allergen flags.",
  intolerance: "Makes someone unwell but isn't dangerous. Checked where a dish can declare it.",
  dislike: "Foods people would rather avoid. A count, never a name — menu input, not a safety check.",
};

// Who has answered, and who hasn't, stated as plainly as the content below
// it. "Nobody has an allergy" and "nobody has told us" are different facts and
// a cook acts on them differently, so the counts are never left out.
function Counts({ s }: { s: SignalSummary }) {
  const parts = [
    `${s.answered} of ${s.population} answered`,
    s.declined > 0 ? `${s.declined} preferred not to say` : null,
    s.deferred > 0 ? `${s.deferred} said not yet` : null,
    s.withheld > 0 ? `${s.withheld} answered but didn't share it with the kitchen` : null,
    s.notAnswered > 0 ? `${s.notAnswered} not asked or not yet` : null,
  ].filter(Boolean);
  return <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{parts.join(" · ")}</p>;
}

function Unwired({ signal }: { signal: KitchenSignal }) {
  return (
    <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
      No question is set up to tell the kitchen about {TITLES[signal].toLowerCase()}, so there is nothing to show — which
      is not the same as nobody having any.{" "}
      <Link href={SETTINGS} className="font-medium text-[var(--accent-1)] hover:underline">
        Set it up in Settings
      </Link>{" "}
      (an Admin can do this).
    </p>
  );
}

function NotReadable({ s }: { s: SignalSummary }) {
  return (
    <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
      The question &ldquo;{s.question!.label}&rdquo; is set up, but its answers aren&rsquo;t readable by your kitchen task,
      so nothing is shown.{" "}
      <Link href={SETTINGS} className="font-medium text-[var(--accent-1)] hover:underline">
        An Admin can change who reads it
      </Link>
      .
    </p>
  );
}

// Group the members by what they ticked, in their words, so a cook sees
// "Peanuts: Sam, Bob" rather than a row per person to scan for the word. An
// intolerance of "Lactose" reads as Lactose even though it is checked against
// the Milk flag.
function groupByTick(s: SignalSummary) {
  const checkable = new Map<string, string[]>();
  const unchecked = new Map<string, string[]>();
  for (const m of s.members) {
    for (const t of m.ticks) {
      const into = t.flag ? checkable : unchecked;
      into.set(t.label, [...(into.get(t.label) ?? []), m.name]);
    }
  }
  return { checkable, unchecked };
}

function PeopleSignal({ s }: { s: SignalSummary }) {
  const tone = s.signal === "allergy" ? "danger" : "warning";
  const { checkable, unchecked } = groupByTick(s);
  const empty = checkable.size + unchecked.size + s.writeIns.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <Counts s={s} />
      {empty ? (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          {s.answered === 0 ? "Nobody has answered yet." : "Everyone who answered has nothing to flag."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...checkable.entries()].map(([label, names]) => (
            <li key={label} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <Tag tone={tone}>{label}</Tag>
              {names.join(", ")}
            </li>
          ))}
          {[...unchecked.entries()].map(([label, names]) => (
            <li key={label} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <Tag>{label}</Tag>
              {names.join(", ")}
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">— a dish can&rsquo;t declare this, so read the menu</span>
            </li>
          ))}
        </ul>
      )}
      {s.writeIns.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
          <span className={LABEL}>In their own words</span>
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Read these yourself: the kitchen doesn&rsquo;t try to interpret them, so they are never checked against a dish.
          </p>
          <ul className="flex flex-col gap-1">
            {s.writeIns.map((w, i) => (
              <li key={i} className="text-[length:var(--text-body)] text-[var(--text)]">
                <span className="font-medium">{w.name}</span> — {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DislikeSignal({ s }: { s: SignalSummary }) {
  const max = Math.max(1, ...s.tally.map((t) => t.count));
  return (
    <div className="flex flex-col gap-3">
      <Counts s={s} />
      {s.tally.length === 0 && s.writeIns.length === 0 ? (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          {s.answered === 0 ? "Nobody has answered yet." : "Nobody listed anything to avoid."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {s.tally.map((t) => (
            <li key={t.option} className="flex items-center gap-3 text-[length:var(--text-body)] text-[var(--text)]">
              <span className="w-44 shrink-0">{t.option}</span>
              <span className="h-2 flex-1 rounded-full bg-[var(--neutral-100)]">
                <span className="block h-2 rounded-full bg-[var(--accent-1)]" style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular-nums text-[var(--text-muted)]">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
      {s.writeIns.length > 0 && (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          Also written in: {s.writeIns.map((w) => w.text).join(", ")}
        </p>
      )}
    </div>
  );
}

function Signal({ s }: { s: SignalSummary }) {
  return (
    <section className={`${CARD} flex flex-col gap-3`}>
      <div>
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{TITLES[s.signal]}</h2>
        <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">{BLURBS[s.signal]}</p>
      </div>
      {!s.question ? (
        <Unwired signal={s.signal} />
      ) : !s.readable ? (
        <NotReadable s={s} />
      ) : s.signal === "dislike" ? (
        <DislikeSignal s={s} />
      ) : (
        <PeopleSignal s={s} />
      )}
    </section>
  );
}

export default function DietaryTab({
  overview,
  meals,
  panels,
}: {
  overview: DietaryOverview;
  meals: MealWithDishes[];
  panels: Map<string, MealConstraintPanel>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
        What the community has told the kitchen. You see only what each person agreed to share with you, and everything here
        is a prompt to check — never a guarantee.
      </p>

      <Signal s={overview.signals.allergy} />
      <Signal s={overview.signals.intolerance} />
      <Signal s={overview.signals.dislike} />

      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Meal by meal</h2>
        {meals.length === 0 ? (
          <EmptyState>Add meals to the menu and each one is checked here against what people have told the kitchen.</EmptyState>
        ) : (
          meals.map((meal) => {
            const panel = panels.get(meal.id);
            const declared = meal.dishes.filter((d) => d.allergenFlags.length > 0).length;
            const hasContent = panel && (panel.dishes.length > 0 || panel.unflaggedDishes.length > 0);
            return (
              <div key={meal.id} className={CARD}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{meal.label}</h3>
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{meal.date}</span>
                </div>
                {panel?.coverage && (
                  <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Checked against the {panel.coverage.considered} of {panel.coverage.of} members who could be at this meal —
                    everyone except those who said they aren&rsquo;t coming or whose dates rule them out.
                  </p>
                )}
                {panel && hasContent ? (
                  <MealDietary panel={panel} />
                ) : (
                  <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                    {meal.dishes.length === 0
                      ? "No dishes yet."
                      : `No conflicts among the ${declared} dish${declared === 1 ? "" : "es"} that declare their allergens.`}
                  </p>
                )}
              </div>
            );
          })
        )}
      </section>

      <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
        For everyone&rsquo;s answers side by side, see{" "}
        <Link href="/members/data" className="font-medium text-[var(--accent-1)] hover:underline">
          member data
        </Link>
        .
      </p>
    </div>
  );
}
