import { z } from "zod";
import { addDays } from "./dates";

// docs/plans/accompaniment-plan.md §5. The check-ins an accompaniment starts with: a short list a
// community edits, each row a label and a number of days from one of two anchors. Pure, so the
// settings screen, the validation and the planning below all read one definition.

export const CHECK_IN_ANCHORS = ["after_joining", "before_event"] as const;
export type CheckInAnchor = (typeof CHECK_IN_ANCHORS)[number];

export const checkInRowSchema = z.object({
  label: z.string().trim().min(1, "A check-in needs a name").max(80, "Keep a check-in's name under 80 characters"),
  anchor: z.enum(CHECK_IN_ANCHORS),
  days: z.number().int("Days is a whole number").min(0, "Days can't be negative").max(365, "A year is the longest a check-in can be from its anchor"),
});
export type CheckInRow = z.infer<typeof checkInRowSchema>;

/** More than this is a different tool: a check-in list is meant to be a handful of moments. */
export const MAX_CHECK_INS = 12;
export const checkInsSchema = z.array(checkInRowSchema).max(MAX_CHECK_INS, `At most ${MAX_CHECK_INS} check-ins`);

export const CHECK_IN_ANCHOR_LABEL: Record<CheckInAnchor, string> = {
  after_joining: "days after they join",
  before_event: "days before their event starts",
};

export type PlannedCheckIn = { label: string; date: string };

/**
 * The milestones to make, as dates (YYYY-MM-DD), fixed now and never moved.
 *
 * - *after joining* is always in the future, however soon.
 * - *before the event* needs an event with a start date, and is left out when there is none, and
 *   left out when its date has already passed: a check-in that is overdue before the person has
 *   been given anyone to be checked in by is noise, not a reminder.
 */
export function planCheckIns(rows: CheckInRow[], context: { today: string; eventStart: string | null }): PlannedCheckIn[] {
  const planned: PlannedCheckIn[] = [];
  for (const row of rows) {
    if (row.anchor === "after_joining") {
      planned.push({ label: row.label, date: addDays(context.today, row.days) });
      continue;
    }
    if (!context.eventStart) continue;
    const date = addDays(context.eventStart, -row.days);
    if (date < context.today) continue;
    planned.push({ label: row.label, date });
  }
  return planned;
}
