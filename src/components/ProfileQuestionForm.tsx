import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./ui/kit";
import type { FieldShape, ResponseType } from "@/lib/field-shape";

export type QuestionResponseType = ResponseType;

// One ProfileQuestion's answer form — extracted out of
// src/app/(app)/profile/page.tsx (which had it as `QuestionForm`) and
// dashboard/page.tsx (which had a slightly smaller `OnboardingQuestionForm`
// with no capacity-visibility control) so every surface that asks a
// question renders it identically. Three call sites now: /profile's own
// answer review, the Dashboard's one-time onboarding panel, and
// /questions — the aggregate page the declare-joining controls route to.
//
// The field itself renders through the same FieldPreview as /apply,
// /feedback and the settings builders' live preview, so what a member is
// shown is literally the same component that decides what a submitter
// sees, and a new response type appears here for free rather than needing
// a fourth hand-written branch.
//
// One question per submit, never a batch: ProfileQuestion is
// independently answerable by design (spec's "Profile questions"), so
// deferring or answering one never silently submits its neighbours.
// The multi-submit case (a review screen confirming several already-given
// once-ever answers at once) stays its own component, as dashboard's
// PrefilledAnswersReview already is.
export default function ProfileQuestionForm({
  action,
  questionId,
  shape,
  cycleId,
  feedsCapacitySignal,
  defaultValue,
  defaultCapacityVisibility,
  allowDeferral = true,
  allowPreferNotToSay = false,
  sensitive = false,
  defaultShareWithAudience = true,
}: {
  // The page's own server action, passed in rather than imported: each
  // page's actions.ts owns its own revalidation (same reason
  // dashboard/actions.ts keeps submitOnboardingAnswerAction separate from
  // profile's), and a server action can be handed to a server component
  // as a plain prop the way PrefilledAnswersReview already takes one.
  action: (formData: FormData) => Promise<void>;
  questionId: string;
  // The question's own answer shape, already resolved through
  // field-shape.ts's toFieldShape by the caller. Passed whole rather
  // than as loose props so this component doesn't need its own copy of
  // the field-shape logic.
  shape: FieldShape;
  // Which event a per_cycle/phase answer stamps against, when this form
  // is explicitly about one (submitAnswerInput.cycleId). Omitted
  // everywhere else, which leaves the member's own declared event as the
  // target — the pre-existing behavior on /profile.
  cycleId?: string;
  feedsCapacitySignal?: boolean;
  defaultValue?: unknown;
  defaultCapacityVisibility?: "flag_only" | "open";
  // Whether to offer "I don't know yet" at all. Defaults to true to match
  // the schema's own default; every call site passes the question's real
  // value so a question configured without deferrals never shows the
  // button.
  allowDeferral?: boolean;
  // Whether to offer "prefer not to say" at all. Defaults to false to
  // match the schema — opting every question into a way out of answering
  // it is a decision a community should make deliberately, per question.
  allowPreferNotToSay?: boolean;
  // Whether the question restricts who may read the answer, which is the
  // only condition under which the share box below is offered at all.
  // The two are not a pair: a plain question is readable by the whole
  // community, so there is no audience to decline joining and a box
  // offering that choice would be a control that does nothing.
  sensitive?: boolean;
  defaultShareWithAudience?: boolean;
}) {
  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="questionId" value={questionId} />
      {cycleId && <input type="hidden" name="cycleId" value={cycleId} />}

      <FieldPreview
        field={toPreviewShape({
          ...shape,
          // Never `required` on the HTML input: a ProfileQuestion is
          // answered one at a time and is always skippable, and a
          // browser-level block would stop someone from ever reaching
          // "I don't know yet" or "prefer not to say" on a question
          // they've decided they can't answer yet. The "required" that
          // matters is the community's chasing one, which lives in
          // listOutstandingRequiredQuestions.
          required: false,
          label: "",
        })}
        name="value"
        defaultValue={defaultValue}
        // The page renders the question's label (and its required marker
        // and due date) directly above this form, so the field renders
        // its inputs only.
        hideLabel
      />

      {feedsCapacitySignal && (
        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          Visible to coordinators as
          <select
            name="capacityVisibility"
            defaultValue={defaultCapacityVisibility ?? "flag_only"}
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)]"
          >
            <option value="flag_only">a coarse flag only</option>
            <option value="open">the exact number</option>
          </select>
        </label>
      )}

      {/* Level 2's own lever, and only on a sensitive question. Default
          ON, deliberately: the exposure is already bounded by the access
          rules the community configured, so sharing is the expected
          consequence of answering and un-ticking is the reduction. The
          opposite default would make the safe choice the one people have
          to remember to take, and people don't remember — they answer
          the question in front of them.

          Different from "prefer not to say" above, and the distinction is
          worth keeping: declining removes the answer from the member's
          profile too, this only removes it from the configured audience
          and leaves it theirs. Someone can reasonably want their
          medication recorded for the kitchen team and not want it on
          their public profile. */}
      {sensitive && (
        <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
          <input
            type="checkbox"
            name="shareWithAudience"
            defaultChecked={defaultShareWithAudience}
            className="mt-0.5"
          />
          <span>
            Share my answer with the people this Community has given access to it
            <span className="block text-[12px] text-[var(--text-muted)]">
              Un-ticking keeps your answer on your own profile and out of everyone else&rsquo;s. It stays
              reachable in an emergency either way, and whoever looks then is recorded and you&rsquo;re
              told.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="status" value="answered" className={BUTTON_PRIMARY}>
          Save
        </button>
        {/* A real answer to "we don't know yet", not a skip: a deferred
            required question counts as satisfied (see
            listOutstandingRequiredQuestions), so this never becomes an
            unsatisfiable nag. Hidden entirely when the community has
            marked the question as having no "not yet" — for a date of
            birth or a legal name, offering this just invites a click
            that stores a non-answer. */}
        {allowDeferral && (
          <button type="submit" name="status" value="deferred" className={BUTTON_SECONDARY}>
            I don&rsquo;t know yet
          </button>
        )}
        {/* A deliberate refusal, not an unfinished form — recorded
            permanently as such, and the server refuses the status
            outright on a question that doesn't offer it. A third submit
            button rather than a checkbox on purpose: a checkbox would
            have to be interpreted against whatever else the member also
            filled in (tick the box but typed a value — which did they
            mean?), whereas a button is one unambiguous click, exactly
            like the defer button above. */}
        {allowPreferNotToSay && (
          <button type="submit" name="status" value="declined" className={BUTTON_SECONDARY}>
            Prefer not to say
          </button>
        )}
      </div>
    </form>
  );
}
