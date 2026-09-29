import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Tag, type Tone } from "./ui/kit";
import type { FieldShape, ResponseType } from "@/lib/field-shape";
import SelectField from "@/components/ui/SelectField";

export type QuestionResponseType = ResponseType;

/**
 * One audience a restricted question's answer can be shared with, already
 * named — `sensitive-data.ts`'s `Audience`, re-declared structurally rather
 * than imported because that module is db-touching and this is a plain prop
 * of a Server Component. Two strings, and the compile-time check is the
 * point.
 */
export type QuestionAudience = { ruleId: string; label: string };

/**
 * Who can read this answer, as one value.
 *
 * A discriminated union rather than the `sensitive` boolean plus a separate
 * audiences list, and the reason is a failure mode rather than tidiness: a
 * restricted question whose caller forgot the list would render no boxes and
 * then store "shared with nobody" on save. The union makes that a type error,
 * so the dangerous version of the mistake can't be written — and
 * `defaultSharedRuleIds` lives on the restricted arm where it means something,
 * rather than being a prop that is silently meaningless for a public question.
 */
export type QuestionAccess =
  | { kind: "public" }
  | { kind: "restricted"; audiences: QuestionAudience[]; defaultSharedRuleIds?: string[] };

// Named in one place because these three are meant to read as one system:
// an audience fact (who can read), a reach somebody chose on your behalf
// (emergency), and a use of the answer in aggregate (a community figure).
// Same shape, three different claims, so three different colours.
const ACCESS_TAG: Record<"public" | "restricted", { tone: Tone; text: string }> = {
  public: { tone: "neutral", text: "everyone can read this" },
  restricted: { tone: "warning", text: "restricted" },
};

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
  access = { kind: "public" },
  publishedAsIndicator = false,
  emergencyAccess = false,
  gatingPurpose = null,
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
  // Who can read this answer, and — on a restricted one — the specific
  // audiences the member is being asked about. Defaults to public because
  // a public question genuinely needs nothing here, and the two visibility
  // states are the point: a public answer has no audience to decline
  // joining, so offering a box about that would be a control that does
  // nothing.
  access?: QuestionAccess;
  // Whether this question is currently published as a community
  // indicator. Shown because being counted in a chart is a fact about your
  // answer, and the member's only lever on it — "prefer not to say" — is
  // one they have to know exists in order to use.
  publishedAsIndicator?: boolean;
  // Whether this question can be read by whoever activates Emergency
  // access on the member's page. Only reachable on a restricted question
  // (an emergency access that has nothing to override would log a read of
  // public data as though it had been protected), so it is a statement
  // about somebody else's reach over you rather than a setting.
  emergencyAccess?: boolean;
  // The consent purpose gating this question, when the Community has
  // pinned one to it. Answering without active consent is refused by
  // answerProfileQuestion, so this box is how a member grants it — the
  // same "consent on the same form, not on a settings screen visited in
  // advance" shape the four fixed member columns used before they were
  // dropped. Null when the question is ungated, in which case no box.
  gatingPurpose?: { key: string; label: string; noticeText: string } | null;
}) {
  const restricted = access.kind === "restricted";
  // Defaults to every audience ticked, which is what the single share-box
  // it replaced did and what `shareWithAudience` defaulted to: answering a
  // restricted question against an audience the community configured is the
  // expected consequence, and un-ticking is the reduction. The opposite
  // default would make the safe choice the one people have to remember to
  // take, and people don't remember — they answer the question in front of
  // them.
  //
  // An explicit `defaultSharedRuleIds` — however short — is respected as
  // given, so a member who declined an audience and comes back to fix an
  // unrelated field on the same question doesn't find it silently re-ticked.
  const sharedByDefault = restricted
    ? access.defaultSharedRuleIds ?? access.audiences.map((a) => a.ruleId)
    : [];

  return (
    <form action={action} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="questionId" value={questionId} />
      {cycleId && <input type="hidden" name="cycleId" value={cycleId} />}

      {/* What this answer is and is not for, above the field rather than
          under the buttons. Three separate facts, and each was previously
          either invisible or buried in a paragraph on a different page:
          who can read it, whether a crisis can reach it, and whether it is
          counted in a published figure. A member who is about to type
          their medication into a box is entitled to all three at the
          moment they do. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={ACCESS_TAG[access.kind].tone}>{ACCESS_TAG[access.kind].text}</Tag>
        {publishedAsIndicator && <Tag tone="accent">counted in a community figure</Tag>}
        {emergencyAccess && <Tag tone="warning">readable in an emergency</Tag>}
      </div>

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
        <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
          Visible to coordinators as
          <SelectField
            name="capacityVisibility"
            defaultValue={defaultCapacityVisibility ?? "flag_only"}
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)]"
          >
            <option value="flag_only">a coarse flag only</option>
            <option value="open">the exact number</option>
          </SelectField>
        </label>
      )}

      {gatingPurpose && (
        /* The write gate, and the only place a member can satisfy it:
           answerProfileQuestion refuses to store an answer for a gated
           question without active consent, so ticking this and submitting
           is what grants it. Placed above the share boxes because it is the
           coarser of the two decisions — it decides whether the answer
           exists for anyone else at all, where the share boxes only decide
           which of the configured audiences sees it. */
        <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
          <input type="checkbox" name={`consent_${gatingPurpose.key}`} className="mt-0.5" />
          <span>
            I agree to this being recorded for &ldquo;{gatingPurpose.label}&rdquo;
            <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {gatingPurpose.noticeText} You can withdraw this at any time from your profile, and the
              answer stops being shown to anyone else straight away.
            </span>
          </span>
        </label>
      )}

      {restricted && <AudienceConsent access={access} sharedByDefault={sharedByDefault} />}

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

/**
 * "Share my answer with…" — one box per audience currently on the question.
 *
 * This replaces a single tick for "the people this Community has given
 * access to it", which was consent to a set the member never saw: they were
 * agreeing to the kitchen, the welfare team and anybody added next year in
 * one click, and could not accept the kitchen while declining the rest. A
 * box per audience is the same consent the *widening* flow already asks
 * for — one prompt per group, arrived at by a different route — so the two
 * halves of the model finally agree with each other.
 *
 * A restricted question with no audience at all gets a sentence instead of
 * boxes. It resolves to nobody-but-the-owner today, a box there would be a
 * control that decides nothing, and the member is better served by being
 * told the arrangement than by being shown a form for it. The empty marker
 * input is still rendered, because "no boxes ticked" and "no boxes on the
 * page" have to arrive at the server as the same thing.
 */
function AudienceConsent({
  access,
  sharedByDefault,
}: {
  access: Extract<QuestionAccess, { kind: "restricted" }>;
  sharedByDefault: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name="shareRuleIds" value="" />
      {access.audiences.length === 0 ? (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          Nobody else can read this &mdash; not the whole community, and not the people who would
          normally be given access. It stays on your own profile, and reachable by whoever
          activates Emergency access on your page, who is recorded when they do.
        </p>
      ) : (
        <>
          <span className="text-[length:var(--text-body)] text-[var(--text)]">Share my answer with</span>
          {access.audiences.map((a) => (
            <label key={a.ruleId} className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input
                type="checkbox"
                name="shareRuleIds"
                value={a.ruleId}
                defaultChecked={sharedByDefault.includes(a.ruleId)}
                className="mt-0.5"
              />
              <span>{a.label}</span>
            </label>
          ))}
        </>
      )}
    </div>
  );
}
