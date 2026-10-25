import type { MealSlot } from "@/db/schema";
import type { MealAttendance, MealWithDishes } from "@/lib/kitchen";
import { MEAL_SLOT_LABELS } from "@/lib/kitchen/attendance";
import { BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "./parts";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/**
 * How a worked-out headcount was reached, in the words a cook would use, so
 * the number is never a black box. Every line is about something the holder
 * could act on: who is counted without being sure, who isn't counted yet, and
 * who has given no dates at all.
 */
export function HeadCountWorking({ attendance, guests }: { attendance: MealAttendance; guests: number }) {
  if (!attendance.available) return null;
  const parts: string[] = [];
  if (attendance.present === 0) {
    parts.push("Nobody has said they're coming yet.");
  } else {
    parts.push(
      `${attendance.present} coming and there${guests > 0 ? `, plus ${guests} guest${guests === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (attendance.arriving > 0 || attendance.leaving > 0) {
    const bits = [
      attendance.arriving > 0 ? `${attendance.arriving} arriving` : null,
      attendance.leaving > 0 ? `${attendance.leaving} leaving` : null,
    ].filter(Boolean);
    parts.push(`${bits.join(" and ")} that day.`);
  }
  if (attendance.uncertain > 0) {
    parts.push(
      `${attendance.uncertain} counted without knowing — their arrival or departure day, with no time or meal given for it.`,
    );
  }
  if (attendance.noDates > 0) {
    parts.push(`${attendance.noDates} gave no dates and are assumed there throughout.`);
  }
  if (attendance.maybe > 0) {
    parts.push(`${attendance.maybe} maybe, not counted.`);
  }
  return <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">{parts.join(" ")}</p>;
}

/**
 * The meal form, for adding a meal and for editing one.
 *
 * Everything about when and how many is optional. A meal needs only a name
 * and a date; the slot and clock time exist so that a person who arrives or
 * leaves part-way through a day can be counted for the right meals, and the
 * headcount can be typed or worked out from the event's arrivals. A standing
 * menu has no event, so there it's typed — and the form says why rather than
 * leaving the choice out.
 */
export function MealForm({
  action,
  hidden,
  meal,
  canUseArrivals,
  times,
  attendance,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  meal?: MealWithDishes;
  canUseArrivals: boolean;
  times: Record<MealSlot, string>;
  attendance?: MealAttendance;
  submitLabel: string;
}) {
  const source = meal?.headCountSource === "participation" && canUseArrivals ? "participation" : "manual";
  return (
    <form action={action} className="flex flex-col gap-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <TextField label="What is it?" name="label" defaultValue={meal?.label} placeholder="e.g. Friday dinner" required />
      <TextField label="Date" name="date" type="date" defaultValue={meal?.date} required />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Which meal (optional)</span>
          <select name="slot" defaultValue={meal?.slot ?? ""} className={INPUT}>
            <option value="">Not specified</option>
            {SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {MEAL_SLOT_LABELS[slot]} — usually {times[slot]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Time, if it isn&rsquo;t the usual (optional)</span>
          <input type="time" name="time" defaultValue={meal?.time?.slice(0, 5) ?? ""} className={INPUT} />
        </label>
      </div>
      <p className="-mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        These only help work out who is there when someone arrives or leaves part-way through a day. A meal with neither is
        fine; those days are counted and marked as a guess.
      </p>

      <fieldset className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <legend className="px-1 text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">How many are eating</legend>
        {canUseArrivals ? (
          <>
            <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="radio" name="headCountSource" value="participation" defaultChecked={source === "participation"} className="mt-1" />
              <span>
                Work it out from who&rsquo;s coming
                <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Counts members who said they&rsquo;re coming and are there for this meal, from their arrival and departure.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="radio" name="headCountSource" value="manual" defaultChecked={source === "manual"} className="mt-1" />
              <span>I&rsquo;ll enter the number myself</span>
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="headCountSource" value="manual" />
            <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
              This is a standing menu, which has no event to take arrivals from, so enter the number yourself.
            </p>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Headcount"
            name="headCount"
            type="number"
            min={1}
            defaultValue={meal?.headCount ? String(meal.headCount) : ""}
            hint="Used when you enter it yourself, or when nobody has said they're coming."
          />
          {canUseArrivals && (
            <TextField
              label="Plus guests"
              name="guests"
              type="number"
              min={0}
              defaultValue={meal?.guests ? String(meal.guests) : ""}
              hint="Visitors and helpers who aren't members. Added to the worked-out number."
            />
          )}
        </div>
        {attendance && meal?.headCountSource === "participation" && <HeadCountWorking attendance={attendance} guests={meal.guests} />}
      </fieldset>

      <TextField label="Notes" name="notes" rows={2} defaultValue={meal?.notes ?? ""} />
      <div>
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
