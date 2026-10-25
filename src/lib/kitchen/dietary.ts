import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dish, member, profileAnswer, profileQuestion, type KitchenSignal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import {
  listReadableSensitiveQuestionIds,
  questionsReadableBy,
  resolveReadableAnswersForCommunity,
} from "../sensitive-data";
import { requireKitchenOwner } from "./access";
import { getMenuPlan } from "./menu";
import { attendanceForMeal, loadAttendanceContext } from "./attendance";
import { getMeal } from "./meals";
import {
  flagForAllergyOption,
  flagForIntoleranceOption,
  type ConcreteAllergenFlag,
} from "./allergens";

// The vocabularies live in ./allergens (db-free, so the starter question set
// can use them from a client bundle). Re-exported so every existing import
// of `@/lib/kitchen/dietary` keeps working.
export * from "./allergens";

type Member = typeof memberTable.$inferSelect;

// The Kitchen's dietary surface — docs/plans/archive/kitchen-redesign-plan.md D1–D4.
//
// The rule that shapes everything below: **a ticked option is compared for
// equality; free text is shown, never interpreted.** The previous version
// keyword-matched every readable sensitive answer against a dish's flags,
// which meant a write-in of "no fish sauce please" matched the fish flag,
// a write-in of "celery" matched nothing, and a multi-choice answer was
// skipped altogether (it only read strings). Now an admin points a question
// at a signal (`profile_question.kitchen_signal`) and the answers are read
// by their shape.
//
// Access is unchanged and still the only access: the audience rules, the
// member's share switch and each answer's consent all decide what a holder
// may read, through the same resolver `/members/data` uses. Tagging a
// question grants nothing; it only says which answers to interpret.

export type SignalMember = {
  memberId: string;
  name: string;
  /** Every option they ticked, in their words, each with the dish flag it
   *  stands for (null when a dish can't declare it — "Fructose"). What the
   *  cook is shown: an intolerance of "Lactose" reads as Lactose, not as the
   *  Milk flag it is checked against. */
  ticks: { label: string; flag: ConcreteAllergenFlag | null }[];
  /** The flags those ticks stand for — the only part that can be checked
   *  against a menu. */
  flags: ConcreteAllergenFlag[];
  /** Ticked options with no dish flag ("Fructose"). Shown to the cook,
   *  matched against nothing. */
  listed: string[];
  /** "Other" write-ins and, for a legacy written-answer question, the
   *  whole answer. Verbatim. */
  writeIns: string[];
};

export type SignalSummary = {
  signal: KitchenSignal;
  /** The question wired to this signal, or null when none is. */
  question: { id: string; label: string; responseType: string } | null;
  /** Whether this holder is in the question's audience. A wired question the
   *  holder can't read is a different message from an unwired one: the first
   *  is for the Admin to fix, the second is for the holder to ask about. */
  readable: boolean;
  population: number;
  /** Answered, and readable by this holder. An answer of "nothing" is still
   *  an answer, so this can exceed `members.length`. */
  answered: number;
  /** Answered, but not readable by this holder — the member un-ticked
   *  sharing, or hasn't agreed to this audience. Reported rather than
   *  hidden, because "0 disclosed" and "3 withheld" are not the same. */
  withheld: number;
  declined: number;
  deferred: number;
  notAnswered: number;
  /** allergy and intolerance only. */
  members: SignalMember[];
  /** dislike only: a count per option, never a name. */
  tally: { option: string; count: number }[];
  /** Write-ins. Named for allergy/intolerance, where a cook must be able to
   *  ask; nameless for dislikes, which are only ever a count. */
  writeIns: { name: string | null; text: string }[];
};

export type DietaryOverview = {
  signals: Record<KitchenSignal, SignalSummary>;
  /** How many of the three signals have a question wired to them. */
  wired: number;
};

const SIGNALS: KitchenSignal[] = ["allergy", "intolerance", "dislike"];

function emptySummary(signal: KitchenSignal, population: number): SignalSummary {
  return {
    signal,
    question: null,
    readable: false,
    population,
    answered: 0,
    withheld: 0,
    declined: 0,
    deferred: 0,
    notAnswered: population,
    members: [],
    tally: [],
    writeIns: [],
  };
}

function stringsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * Everything the kitchen has been told, for one holder, in one read.
 *
 * Always returns something to render — never null — because a dietary view
 * that goes silent when there is nothing to show is how a cook mistakes
 * "nobody has an allergy" for "nobody has told us". Each signal says which of
 * those it is: not wired, wired but not readable by you, or readable with
 * counts for who answered, declined, deferred, withheld and hasn't been
 * asked.
 */
export async function getDietaryOverview(actor: Member, cycleId?: string | null): Promise<DietaryOverview> {
  await requireKitchenOwner(actor, cycleId);

  const members = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, actor.communityId));
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const signals = Object.fromEntries(SIGNALS.map((s) => [s, emptySummary(s, members.length)])) as Record<
    KitchenSignal,
    SignalSummary
  >;

  const tagged = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        isNotNull(profileQuestion.kitchenSignal),
        isNull(profileQuestion.archivedAt),
      ),
    );
  if (tagged.length === 0) return { signals, wired: 0 };

  // Which wired questions this holder is in the audience for. A public
  // question is everyone's; a sensitive one is the audience's.
  const sensitiveReadable = await listReadableSensitiveQuestionIds(actor);
  const readable = await resolveReadableAnswersForCommunity(actor);

  const rows = await db
    .select({
      memberId: profileAnswer.memberId,
      questionId: profileAnswer.questionId,
      status: profileAnswer.status,
      value: profileAnswer.value,
    })
    .from(profileAnswer)
    .where(
      and(
        inArray(profileAnswer.questionId, tagged.map((q) => q.id)),
        isNull(profileAnswer.cycleId),
      ),
    );

  for (const question of tagged) {
    const signal = question.kitchenSignal!;
    const summary = signals[signal];
    summary.question = { id: question.id, label: question.label, responseType: question.responseType };
    summary.readable = !question.sensitive || sensitiveReadable.has(question.id);
    // Nothing further is computed for a question the holder can't read:
    // even a count of who declined is information from outside their
    // audience, and the holder needs only to know it isn't theirs.
    if (!summary.readable) continue;

    const own = rows.filter((r) => r.questionId === question.id && nameById.has(r.memberId));
    summary.declined = own.filter((r) => r.status === "declined").length;
    summary.deferred = own.filter((r) => r.status === "deferred").length;

    const tally = new Map<string, number>(question.options.map((o) => [o, 0]));
    for (const row of own) {
      if (row.status !== "answered") continue;
      if (!questionsReadableBy(readable, row.memberId).has(question.id)) {
        summary.withheld++;
        continue;
      }
      summary.answered++;

      const name = nameById.get(row.memberId) ?? "—";
      const entry: SignalMember = { memberId: row.memberId, name, ticks: [], flags: [], listed: [], writeIns: [] };

      if (question.responseType === "text") {
        // A legacy written answer. Shown whole, matched against nothing.
        entry.writeIns = stringsOf(row.value);
      } else {
        for (const v of stringsOf(row.value)) {
          const isOption = question.options.includes(v);
          if (!isOption) {
            entry.writeIns.push(v);
            continue;
          }
          if (signal === "dislike") {
            tally.set(v, (tally.get(v) ?? 0) + 1);
            continue;
          }
          const flag = signal === "allergy" ? flagForAllergyOption(v) : flagForIntoleranceOption(v);
          entry.ticks.push({ label: v, flag });
          if (flag) {
            if (!entry.flags.includes(flag)) entry.flags.push(flag);
          } else {
            entry.listed.push(v);
          }
        }
      }

      if (signal === "dislike") {
        // Counts only, so write-ins lose their names too.
        for (const text of entry.writeIns) summary.writeIns.push({ name: null, text });
      } else {
        for (const text of entry.writeIns) summary.writeIns.push({ name, text });
        if (entry.flags.length + entry.listed.length + entry.writeIns.length > 0) {
          summary.members.push(entry);
        }
      }
    }

    summary.members.sort((a, b) => a.name.localeCompare(b.name));
    summary.writeIns.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.text.localeCompare(b.text));
    summary.tally = [...tally.entries()]
      .map(([option, count]) => ({ option, count }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count || a.option.localeCompare(b.option));
    summary.notAnswered =
      summary.population - (summary.answered + summary.withheld + summary.declined + summary.deferred);
  }

  return { signals, wired: tagged.length };
}

export type DishConflict = {
  memberId: string;
  name: string;
  matchedFlags: ConcreteAllergenFlag[];
  /** What the member ticked that matched, in their words. */
  matchedLabels: string[];
};

export type MealConstraintPanel = {
  mealId: string;
  /** Dishes whose declared flags equal something a member ticked. Only
   *  dishes with at least one conflict appear. */
  dishes: {
    dishId: string;
    dishName: string;
    flags: ConcreteAllergenFlag[];
    allergy: DishConflict[];
    intolerance: DishConflict[];
  }[];
  /** Who the check covered. Null when the menu has no event to take
   *  arrivals from, in which case every member who shared an answer is
   *  considered, as before. */
  coverage: { considered: number; of: number } | null;
  /** Dishes that declare nothing — not "safe", just unchecked. A dish marked
   *  `none_known` is a statement; an empty list is an absence, and the cook
   *  should be able to tell the two apart. */
  unflaggedDishes: { dishId: string; dishName: string }[];
};

function concreteFlags(flags: string[]): ConcreteAllergenFlag[] {
  return flags.filter((f): f is ConcreteAllergenFlag => f !== "none_known") as ConcreteAllergenFlag[];
}

/**
 * Compare a meal's dishes against the overview. Pure, so the page can read
 * the overview once and test every meal against it rather than re-reading
 * the community's answers per meal.
 *
 * Exact set intersection between a dish's declared flags and a member's
 * ticked flags, nothing more. A dish nobody conflicts with is absent from
 * the result, which is the point of the separate `unflaggedDishes` list: the
 * absence of a conflict only means something for a dish that declared its
 * contents.
 */
export function compareMealToOverview(
  overview: DietaryOverview,
  mealId: string,
  dishes: { id: string; name: string; allergenFlags: string[] }[],
  // Who could be at this meal (attendance.ts's `possibleMemberIds`), or null
  // to consider everyone. Only ever narrows: it removes people who said they
  // aren't coming or whose dates rule them out, and keeps everyone else —
  // including people who haven't said, and maybes — because a missed allergy
  // costs more than an extra name.
  possible: ReadonlySet<string> | null = null,
): MealConstraintPanel {
  const considered = (members: SignalMember[]) =>
    possible ? members.filter((m) => possible.has(m.memberId)) : members;
  const conflictsFor = (signal: "allergy" | "intolerance", flags: ConcreteAllergenFlag[]): DishConflict[] =>
    considered(overview.signals[signal].members)
      .map((m) => ({
        memberId: m.memberId,
        name: m.name,
        matchedFlags: flags.filter((f) => m.flags.includes(f)),
        matchedLabels: m.ticks.filter((t) => t.flag !== null && flags.includes(t.flag)).map((t) => t.label),
      }))
      .filter((c) => c.matchedFlags.length > 0);

  const panel: MealConstraintPanel = {
    mealId,
    dishes: [],
    unflaggedDishes: [],
    coverage: possible ? { considered: possible.size, of: overview.signals.allergy.population } : null,
  };
  for (const d of dishes) {
    if (d.allergenFlags.length === 0) {
      panel.unflaggedDishes.push({ dishId: d.id, dishName: d.name });
      continue;
    }
    const flags = concreteFlags(d.allergenFlags);
    if (flags.length === 0) continue; // explicitly "none known"
    const allergy = conflictsFor("allergy", flags);
    const intolerance = conflictsFor("intolerance", flags);
    if (allergy.length + intolerance.length > 0) {
      panel.dishes.push({ dishId: d.id, dishName: d.name, flags, allergy, intolerance });
    }
  }
  return panel;
}

/** One meal's panel, for a caller that has no overview yet. */
export async function getMealConstraintPanel(actor: Member, mealId: string): Promise<MealConstraintPanel> {
  const mealRow = await getMeal(actor, mealId);
  const plan = await getMenuPlan(actor, mealRow.menuPlanId);
  const overview = await getDietaryOverview(actor, plan.cycleId);
  const dishes = await db.select().from(dish).where(eq(dish.mealId, mealId));
  const ctx = await loadAttendanceContext(actor, plan);
  const possible = ctx ? new Set(attendanceForMeal(mealRow, ctx).possibleMemberIds) : null;
  return compareMealToOverview(overview, mealId, dishes, possible);
}
