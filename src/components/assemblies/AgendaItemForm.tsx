"use client";

import { useActionState, useEffect, useState } from "react";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "../ui/kit";
import { SubmitButton } from "../ui/SubmitButton";
import { RESPONSE_TYPE_HINTS, responseTypeNoun } from "@/lib/field-shape";

export type AgendaItemFormState = { error?: string; ok?: boolean };

// The same six shapes every other question system uses, in this
// component's own radio-card presentation. The wording comes from
// field-shape.ts rather than living here as a second set: this used to
// be the fourth hand-written copy, and a copy is exactly what goes stale
// — the shared `RESPONSE_TYPE_HINTS` are the sentences under each card,
// which is what this component was already writing out inline.
const RESPONSE_TYPES = [
  { value: "text", hint: RESPONSE_TYPE_HINTS.text },
  { value: "single_choice", hint: RESPONSE_TYPE_HINTS.single_choice },
  { value: "multi_choice", hint: RESPONSE_TYPE_HINTS.multi_choice },
  { value: "boolean", hint: RESPONSE_TYPE_HINTS.boolean },
  { value: "date", hint: RESPONSE_TYPE_HINTS.date },
  { value: "number", hint: RESPONSE_TYPE_HINTS.number },
] as const;

// The card's title. The shared noun map supplies these: "Written answer"
// and "Pick one" were this form's own wording, and the dropdown labels
// ("Text", "Single choice") would be a step backwards for the two that
// already had better copy.
const typeTitle = responseTypeNoun;

function isChoice(value: string) {
  return value === "single_choice" || value === "multi_choice";
}

/**
 * Adding an agenda item during the agenda-building window.
 *
 * Two things this fixes, both of which made the old version close to
 * unusable:
 *
 *  - **The options editor.** Options used to be one comma-separated
 *    text field, permanently on screen even for a written-answer item.
 *    That made options containing a comma impossible to express (it
 *    split them in two), let duplicates through (two radios sharing one
 *    name *and* one value, so the browser treated them as one control
 *    while the tally counted them as two answers), and quietly committed
 *    dead options onto written-answer items that could never be shown
 *    again. Each option is now its own field, added one at a time, and
 *    the whole editor only exists for the two choice types. The
 *    "+ Add option" pattern is FieldShapeEditor's, reused rather than
 *    reinvented.
 *
 *  - **Errors that don't eat your work.** The old form submitted to a
 *    server action that redirected back with `?error=…`, which
 *    re-rendered the page with an empty form — everything typed was gone,
 *    including a half-written option list. The action now returns its
 *    error instead, so the draft below survives a rejected submit and
 *    the message sits right above the field it came from.
 */
export default function AgendaItemForm({
  action,
  assemblyId,
}: {
  // The page's own server action, passed in as a prop — the same
  // convention ProfileQuestionForm documents: each page's actions.ts
  // owns its own revalidation.
  action: (
    prev: AgendaItemFormState,
    formData: FormData,
  ) => Promise<AgendaItemFormState>;
  assemblyId: string;
}) {
  const [state, formAction] = useActionState(action, {} as AgendaItemFormState);

  const [text, setText] = useState("");
  const [responseType, setResponseType] = useState<string>("text");
  const [options, setOptions] = useState<string[]>(["", ""]);
  // The field-shape flags an agenda item can carry — see
  // src/lib/field-shape.ts. Presentational on this form, but real
  // settings on the row: they're serialized as hidden inputs below and
  // stored by addAgendaItem.
  const [multiline, setMultiline] = useState(true);
  const [allowOther, setAllowOther] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  // A successful add clears the draft, so the next item starts fresh —
  // but only on the transition, never on a plain re-render.
  useEffect(() => {
    if (state.ok) {
      setText("");
      setResponseType("text");
      setOptions(["", ""]);
      setMultiline(true);
      setAllowOther(false);
      setMin("");
      setMax("");
    }
  }, [state.ok]);

  const choice = isChoice(responseType);
  const isText = responseType === "text";
  const isNumber = responseType === "number";
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupe = new Set(filled).size !== filled.length;
  // Block the submit rather than letting it round-trip and bounce off
  // the server, for the two things a member can see and fix right here.
  const incomplete = choice && filled.length < 2;

  return (
    <form action={formAction} className="mt-6 flex max-w-[560px] flex-col gap-3">
      <input type="hidden" name="assemblyId" value={assemblyId} />
      <input type="hidden" name="responseType" value={responseType} />
      <input type="hidden" name="multiline" value={isText && multiline ? "on" : ""} />
      <input type="hidden" name="allowOther" value={choice && allowOther ? "on" : ""} />
      <input type="hidden" name="min" value={isNumber ? min : ""} />
      <input type="hidden" name="max" value={isNumber ? max : ""} />

      <div>
        <h2 className="text-[15px] font-semibold text-[var(--text)]">Add an agenda item</h2>
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
          Anyone can add items until the agenda-building window closes, and can withdraw anything
          they added themselves.
        </p>
      </div>

      {state.error && <Banner tone="danger">{state.error}</Banner>}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>The question or motion</span>
        <input
          type="text"
          name="text"
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Where on the map should the barrio go?"
          className={INPUT}
        />
      </label>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={LABEL}>How should members answer it?</legend>
        <div className="flex flex-col gap-1">
          {RESPONSE_TYPES.map((rt) => (
            <label key={rt.value} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input
                type="radio"
                name="responseTypeChoice"
                value={rt.value}
                checked={responseType === rt.value}
                onChange={() => {
                  setResponseType(rt.value);
                  // Growing the list from one blank to two on the way
                  // in, and collapsing it on the way out, so switching
                  // back to a written answer can't strand options.
                  if (!isChoice(rt.value)) setOptions(["", ""]);
                  else if (options.filter((o) => o.trim()).length < 2) setOptions(["", ""]);
                }}
              />
              <span>
                {typeTitle(rt.value)} <span className="text-[var(--text-muted)]">— {rt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {choice && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <span className={LABEL}>The answers people pick from</span>
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                name="option"
                value={option}
                onChange={(e) => {
                  const next = [...options];
                  next[i] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`Answer ${i + 1}`}
                aria-label={`Answer ${i + 1}`}
                className={`${INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                title="Remove this answer"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--danger)]"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions([...options, ""])}
            className="w-fit text-[12px] font-medium text-[var(--accent-1)] hover:underline"
          >
            + Add another answer
          </button>
          {dupe && (
            <p className="text-[12px] text-[var(--danger)]">
              Two answers are worded the same — members couldn&apos;t tell them apart when voting.
            </p>
          )}
          {incomplete && !dupe && (
            <p className="text-[12px] text-[var(--danger)]">
              A {responseType === "single_choice" ? "pick-one" : "pick-any"} question needs at least
              two answers.
            </p>
          )}
          {/* The escape hatch, on a vote. Deliberately offered here but
              with the consequence stated: the tally can't attribute a
              free-text answer to an option, so it appears as its own
              "wrote their own answer" row and the percentages are of
              everyone who answered. A motion is usually a motion to
              pick one, and offering this by default would quietly turn
              half of them into something untallied. */}
          {choice && (
            <label className="mt-1 flex items-start gap-2 text-[12px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={allowOther}
                onChange={(e) => setAllowOther(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Let members write their own answer instead. Their words can&rsquo;t be counted
                against one of the options above &mdash; they&rsquo;ll show as a separate
                &ldquo;wrote their own answer&rdquo; line in the tally.
              </span>
            </label>
          )}
        </div>
      )}

      {isText && (
        <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={multiline}
            onChange={(e) => setMultiline(e.target.checked)}
          />
          Let members write more than a line
        </label>
      )}

      {isNumber && (
        <div className="flex flex-wrap items-center gap-3">
          <span className={LABEL}>Bounds (optional)</span>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
            at least
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className={`${INPUT} w-24`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
            at most
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className={`${INPUT} w-24`}
            />
          </label>
        </div>
      )}

      <SubmitButton
        className={`${BUTTON_PRIMARY} w-fit`}
        pendingLabel="Adding…"
        disabled={dupe || incomplete}
      >
        Add to agenda
      </SubmitButton>
    </form>
  );
}
