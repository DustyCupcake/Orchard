import { Tag } from "../ui/kit";
import { RESPONSE_TYPE_HINTS, isChoiceType, responseTypeNoun } from "@/lib/field-shape";

/**
 * The always-visible description of how a question is answered.
 *
 * This exists because `options` was only ever rendered as the *inputs* of
 * a vote form, and only once voting was open. That left an agenda item's
 * shape invisible in exactly the phases where it matters most: during
 * agenda-building you couldn't check the options you had just typed were
 * right, and during notice — the phase whose entire purpose is "the
 * agenda is locked and visible" — a pick-one question looked identical
 * to a written-answer one, so nobody could read what they were about to
 * vote on.
 *
 * So the shape is stated unconditionally, in one line, and the answers
 * themselves are listed whenever the vote form isn't already showing
 * them. `showAnswers` is false during voting precisely because the
 * radios/checkboxes are the list, and printing it twice would be noise.
 *
 * The wording lives in field-shape.ts rather than here, and that isn't
 * tidiness. This component used to treat "not a choice" as "is prose",
 * which was true while a written answer was the only other type and
 * became false the moment an agenda item could be a date, a figure or a
 * yes/no — each of which rendered as "Written answer — Everyone answers
 * in their own words". Looking the type up can't fail that way.
 */
export default function QuestionShape({
  responseType,
  options,
  allowOther,
  showAnswers,
}: {
  responseType: string;
  options: string[];
  // Whether members may write their own answer instead of picking one.
  // Stated here too, because during notice a reader has no other way to
  // know that an item isn't strictly a choice between the listed
  // answers.
  allowOther?: boolean;
  showAnswers: boolean;
}) {
  const count = options.length;
  // A row's column is read as a plain string, and the composer's zod
  // schema is the only thing guaranteeing one of the six, so the hint
  // lookup is total rather than trusted. `responseTypeNoun` has the same
  // fallback.
  const type = responseType as keyof typeof RESPONSE_TYPE_HINTS;
  const hint = RESPONSE_TYPE_HINTS[type] ?? "Members answer in their own words";

  if (!isChoiceType(type)) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        <Tag tone="neutral">{responseTypeNoun(responseType)}</Tag>
        {hint}
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        <Tag tone="accent">{type === "single_choice" ? "Pick one" : "Pick any"}</Tag>
        {count === 0
          ? "No answers listed — this question can't be answered as it stands"
          : `${count} ${count === 1 ? "answer" : "answers"} to choose from`}
        {allowOther && <span>or write your own</span>}
      </p>
      {showAnswers && count > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {options.map((o) => (
            <li key={o} className="text-[13px] text-[var(--text)]">
              · {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
