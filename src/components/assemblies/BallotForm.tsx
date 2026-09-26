"use client";

import { useActionState, useState } from "react";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "../ui/kit";
import { SubmitButton } from "../ui/SubmitButton";
import { isBlankValue, isChoiceType } from "@/lib/field-shape";
import QuestionShape from "./QuestionShape";

export type BallotFormState = { error?: string; ok?: boolean };

// What a single agenda item's answer can be. Widened from
// `string | string[]` when agenda items joined the six shared field
// shapes (src/lib/field-shape.ts) — a yes/no item answers with a real
// boolean and a figure with a real number, which is what makes them
// countable rather than needing a re-parse of every stored answer.
// `null` is "not answered", the state a member puts an item in by
// leaving it blank.
export type BallotValue = string | string[] | number | boolean | null;

export type BallotQuestion = {
  id: string;
  text: string;
  responseType: string;
  options: string[];
  // The shape flags, so the ballot renders the same controls the item
  // was authored to be answered with. Defaults keep this usable by a
  // caller that hasn't heard of them.
  multiline?: boolean;
  allowOther?: boolean;
  min?: number | null;
  max?: number | null;
  myValue: string | string[] | number | boolean | null;
  responseCount: number;
};

function initialAnswers(questions: BallotQuestion[]): Record<string, BallotValue> {
  const answers: Record<string, BallotValue> = {};
  for (const q of questions) {
    if (q.myValue !== null) answers[q.id] = q.myValue;
  }
  return answers;
}

/**
 * Voting on a whole agenda at once.
 *
 * This replaces one form — and one round-trip, and one "Vote" click —
 * per agenda item. With five items that was five submissions, which is
 * both slow and five separate chances to mis-tap a single radio; a vote
 * is a single act by the person casting it, so it gets a single
 * control.
 *
 * Two things that follow from being one ballot rather than five
 * independent forms:
 *
 *  - **A blank answer means "not this one"**, not an error. Blanking a
 *    field is how a member skips the one question they have no view on,
 *    so it's simply left out of the payload and the rest saves. This is
 *    also why `isBlankValue` is imported rather than a `!v` test: a
 *    `false` boolean and a `0` are answers, not absences, and only the
 *    shared definition knows that.
 *  - **One bad answer doesn't cost you the other four.** The action
 *    reports which question didn't take and the page says so, rather
 *    than rejecting the whole submission.
 */
export default function BallotForm({
  action,
  assemblyId,
  questions,
}: {
  action: (prev: BallotFormState, formData: FormData) => Promise<BallotFormState>;
  assemblyId: string;
  questions: BallotQuestion[];
}) {
  const [state, formAction] = useActionState(action, {} as BallotFormState);
  const [answers, setAnswers] = useState<Record<string, BallotValue>>(() =>
    initialAnswers(questions),
  );
  // The escape hatch's own text, held apart from the chosen option so a
  // ticked option still wins — the same rule fieldValueFromFormData
  // applies to a submitted form. Kept in its own map rather than folded
  // into `answers` for exactly that reason.
  const [others, setOthers] = useState<Record<string, string>>({});

  const setSingle = (id: string, value: BallotValue) => setAnswers((prev) => ({ ...prev, [id]: value }));
  const toggleMulti = (id: string, option: string) =>
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      return {
        ...prev,
        [id]: current.includes(option)
          ? current.filter((o) => o !== option)
          : [...current, option],
      };
    });

  // What this question's answer actually is, with the escape hatch
  // applied the way the server will read it back. Mirrors
  // fieldValueFromFormData's choice branch exactly: a picked option wins,
  // and the free text is only used when nothing real was picked.
  const effectiveValue = (q: BallotQuestion): BallotValue => {
    const v = answers[q.id];
    if (!isChoiceType(q.responseType)) return v ?? null;
    const other = (others[q.id] ?? "").trim();
    if (!q.allowOther || !other) return v ?? null;
    // Strings only, and that's not TypeScript being fussy: a number or
    // boolean on a choice question could only come from a stored answer
    // written under a different type for this item, and appending it to
    // the picked list would put an unselectable value in the payload.
    const chosen = (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []).filter(
      (o): o is string => typeof o === "string",
    );
    return q.responseType === "multi_choice" ? [...chosen, other] : (chosen[0] ?? other);
  };

  const answered = questions.filter((q) => !isBlankValue(effectiveValue(q))).length;
  const allAnswered = answered === questions.length;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="assemblyId" value={assemblyId} />
      {/* The serialised ballot. Derived from state on every render, so
          it is always in step with what's on screen — no submit handler
          needed, and nothing to forget to update.

          Built from `questions` rather than from `answers` so that
          blanking a field is the same operation as never having touched
          it, and so a value is only sent once it survives the same
          blank test the "N of M answered" count uses — the two used to
          be separate derivations that could disagree, and a field the
          count called answered but the payload dropped was the confusing
          case. `isBlankValue` rather than a truthiness test, so `false`
          and `0` are sent. */}
      <input type="hidden" name="answers" value={JSON.stringify(
        questions
          .map((q) => ({ questionId: q.id, value: effectiveValue(q) }))
          .filter((entry) => !isBlankValue(entry.value)),
      )} />

      {state.error && <Banner tone="danger">{state.error}</Banner>}
      {state.ok && (
        <Banner tone="success">
          Your answers are saved. You can change any of them until voting closes.
        </Banner>
      )}

      {questions.map((q, i) => {
        const mine = answers[q.id];
        const other = others[q.id] ?? "";
        const setOther = (v: string) => setOthers((prev) => ({ ...prev, [q.id]: v }));
        return (
          <fieldset key={q.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <legend className="px-1 text-[13px] font-medium text-[var(--text)]">
              {i + 1}. {q.text}
            </legend>

            <QuestionShape
              responseType={q.responseType}
              options={q.options}
              allowOther={q.allowOther}
              showAnswers={false}
            />

            <div className="mt-2.5 flex max-w-[520px] flex-col gap-1.5">
              {q.responseType === "text" &&
                (q.multiline === false ? (
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Your answer</span>
                    <input
                      type="text"
                      value={typeof mine === "string" ? mine : ""}
                      onChange={(e) => setSingle(q.id, e.target.value)}
                      className={INPUT}
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Your answer</span>
                    <textarea
                      rows={3}
                      value={typeof mine === "string" ? mine : ""}
                      onChange={(e) => setSingle(q.id, e.target.value)}
                      className={INPUT}
                    />
                  </label>
                ))}
              {q.responseType === "date" && (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Your answer</span>
                  <input
                    type="date"
                    value={typeof mine === "string" ? mine : ""}
                    onChange={(e) => setSingle(q.id, e.target.value)}
                    className={INPUT}
                  />
                </label>
              )}
              {q.responseType === "number" && (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Your answer</span>
                  <input
                    type="number"
                    value={typeof mine === "number" ? String(mine) : ""}
                    onChange={(e) =>
                      setSingle(q.id, e.target.value.trim() === "" ? "" : Number(e.target.value))
                    }
                    min={q.min ?? undefined}
                    max={q.max ?? undefined}
                    className={INPUT}
                  />
                </label>
              )}
              {q.responseType === "boolean" && (
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Your answer</span>
                  {/* A select rather than a Yes/No radio pair: a member
                      skipping this item has to be able to get back to
                      "no answer", and radios can't be un-ticked. The
                      empty first entry is that state. */}
                  <select
                    value={typeof mine === "boolean" ? String(mine) : ""}
                    onChange={(e) => {
                      if (e.target.value === "") setSingle(q.id, "");
                      else setSingle(q.id, e.target.value === "true");
                    }}
                    className={INPUT}
                  >
                    <option value="">No answer</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              )}
              {q.responseType === "single_choice" &&
                q.options.map((o) => (
                  <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                    <input
                      type="radio"
                      name={`q_${q.id}`}
                      value={o}
                      checked={mine === o}
                      onChange={() => setSingle(q.id, o)}
                    />
                    {o}
                  </label>
                ))}
              {q.responseType === "multi_choice" &&
                q.options.map((o) => {
                  const checked = Array.isArray(mine) && mine.includes(o);
                  return (
                    <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMulti(q.id, o)}
                      />{" "}
                      {o}
                    </label>
                  );
                })}
              {q.allowOther && (q.responseType === "single_choice" || q.responseType === "multi_choice") && (
                <label className="mt-1 flex flex-col gap-1">
                  <span className={LABEL}>Something else (optional)</span>
                  <input
                    type="text"
                    value={other}
                    onChange={(e) => setOther(e.target.value)}
                    placeholder="Your own words"
                    className={INPUT}
                  />
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Only used if you haven&rsquo;t picked one of the answers above — and it shows as
                    its own line in the tally, since words can&rsquo;t be counted against an option.
                  </span>
                </label>
              )}
            </div>

            {q.myValue != null && (
              <p className="mt-1.5 text-[12px] text-[var(--success)]">You&rsquo;ve answered this</p>
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {allAnswered ? "Save all my answers" : "Save the answers I've given"}
        </SubmitButton>
        <span className="text-[12px] text-[var(--text-muted)]">
          {answered} of {questions.length} answered ·{" "}
          {allAnswered ? "you can change any of them until voting closes" : "blank ones are skipped"}
        </span>
      </div>
    </form>
  );
}
