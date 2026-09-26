import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import {
  assertEmergencyHasSomethingToOverride,
  assertIndicatorAllowed,
  assertNotContradictoryWithPublication,
  indicatorBlocker,
} from "./indicators";
import { countQuestionAccessRules } from "../sensitive-data";
import {
  RESPONSE_TYPES,
  TEXT_VALIDATIONS,
  fieldShapeColumnValues,
  isChoiceType,
  toFieldShape,
  type ResponseType,
  type TextValidation,
} from "../field-shape";

type Member = typeof memberTable.$inferSelect;

// Both lists come from src/lib/field-shape.ts rather than being declared
// here, so a ProfileQuestion and a Form field can never drift into
// accepting different answer shapes. The persisted pgEnum in the schema
// is the other half of that same union.
const responseTypes = RESPONSE_TYPES;
const scopes = ["once_ever", "per_cycle", "phase"] as const;

// Standing community structure — gated by requireAdmins at the settings
// action layer (src/app/settings/actions.ts), the same split Branch/Tier
// CRUD already uses: this module stays community-scoped only.
// The field-shape flags (multiline/validation/allowOther/min/max/step)
// are flattened into snake_case here and onto the columns, so this input
// and the row stay a plain one-to-one mapping rather than growing a
// nested `shape` object the schema doesn't have a place for. Which of
// them mean anything is decided by responseType — see
// field-shape.ts's toFieldShape, which zeroes the rest.
const fieldShapeInput = {
  multiline: z.boolean().optional(),
  validation: z.enum(TEXT_VALIDATIONS).optional(),
  allowOther: z.boolean().optional(),
  min: z.number().int().nullable().optional(),
  max: z.number().int().nullable().optional(),
  step: z.number().int().nullable().optional(),
};

export const createProfileQuestionInput = z
  .object({
    label: z.string().min(1),
    responseType: z.enum(responseTypes),
    options: z.array(z.string().min(1)).optional(),
    ...fieldShapeInput,
    scope: z.enum(scopes),
    phaseNameHint: z.string().min(1).nullable().optional(),
    required: z.boolean().optional(),
    // See profile-question.ts's own comment: the date after which a
    // deferral stops satisfying this question. Meaningless unless
    // required, so rejected on its own rather than silently ignored.
    requiredBy: z.string().min(1).nullable().optional(),
    // See profile-question.ts's own comment: whether "I don't know yet"
    // is offered at all.
    allowDeferral: z.boolean().optional(),
    // See profile-question.ts's own comment: whether "prefer not to say"
    // is offered at all. Off by default.
    allowPreferNotToSay: z.boolean().optional(),
    feedsCapacitySignal: z.boolean().optional(),
    // Opting this question into the /community aggregate — see
    // profile-question.ts's own comment for what that means and why only
    // a once_ever, non-text question qualifies. The rules themselves
    // live in indicators.ts so the aggregation and its preconditions
    // can't disagree.
    publishedAsIndicator: z.boolean().optional(),
    // See profile-question.ts's own comments: whether restricting who may
    // read this answer requires declaring it sensitive first, and whether
    // answering it consents to emergency reads. Both are attributes rather
    // than kinds, because a question can be both sensitive and per-event —
    // "medication on site" is — and folding either into a category makes
    // that inexpressible.
    sensitive: z.boolean().optional(),
    emergencyAccess: z.boolean().optional(),
    surfaces: z.array(z.string().min(1)).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.scope === "phase" && !input.phaseNameHint) {
      ctx.addIssue({
        code: "custom",
        message: "phaseNameHint is required when scope is 'phase'",
        path: ["phaseNameHint"],
      });
    }
    if (isChoiceType(input.responseType) && (!input.options || input.options.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "options are required for a choice-based response type",
        path: ["options"],
      });
    }
    // A due date on a question nobody requires answers is a setting that
    // silently does nothing — catch it at the builder rather than letting
    // an admin think deferrals will start expiring.
    if (input.requiredBy && !input.required) {
      ctx.addIssue({
        code: "custom",
        message: "a due date only applies to a required question",
        path: ["requiredBy"],
      });
    }
    // ...and a due date with deferral switched off is unreachable: there'd
    // be no deferral for the date to apply to.
    if (input.requiredBy && input.allowDeferral === false) {
      ctx.addIssue({
        code: "custom",
        message: "a due date only applies to a question that can be deferred",
        path: ["requiredBy"],
      });
    }
  });
export type CreateProfileQuestionInput = z.infer<typeof createProfileQuestionInput>;

// responseType/options are now editable too (docs/development-plan.md's
// Phase 58 — "editable the same as a freshly-created one"), a real
// loosening of this table's previous "structural shape doesn't change
// underneath existing answers" posture. scope/phaseNameHint stay fixed
// (unchanged): those describe *when* a question is asked, not what its
// field looks like, and changing them mid-flight is a genuinely
// different, riskier kind of edit the builder doesn't offer. An
// existing ProfileAnswer's own `value` was validated against the
// question's shape *at the time it was answered* — editing the
// question afterward doesn't retroactively touch any stored answer,
// the same "past answers survive a since-changed definition" reasoning
// `archivedAt` already established for archiving.
export const updateProfileQuestionInput = z
  .object({
    label: z.string().min(1).optional(),
    responseType: z.enum(responseTypes).optional(),
    options: z.array(z.string().min(1)).optional(),
    ...fieldShapeInput,
    required: z.boolean().optional(),
    requiredBy: z.string().min(1).nullable().optional(),
    allowDeferral: z.boolean().optional(),
    allowPreferNotToSay: z.boolean().optional(),
    feedsCapacitySignal: z.boolean().optional(),
    publishedAsIndicator: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    emergencyAccess: z.boolean().optional(),
    surfaces: z.array(z.string().min(1)).optional(),
  });
// No cross-field check on update, unlike create, and deliberately so: the
// settings form submits `required` and `allowDeferral` on every save, so
// turning either one off while a due date is still in the date input is
// an ordinary thing to do, not a mistake. updateProfileQuestion clears
// the unreachable date instead of rejecting the whole save — the same
// "clear the setting that no longer applies" call it already makes for
// options on a since-abandoned choice type.
export type UpdateProfileQuestionInput = z.infer<typeof updateProfileQuestionInput>;

// One question by id, for a caller that has to read a submitted value
// against the shape it was rendered from. The single-question form
// actions use this; answerProfileQuestion's own lookup is a separate
// query rather than a shared one, which is deliberate — the two happen
// at different points and threading a row through would couple them.
export async function getProfileQuestion(actor: Member, questionId: string) {
  const [row] = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Profile question not found");
  }
  return row;
}

// Several at once, for the Dashboard's batched prefilled-answer review —
// it renders N questions into one form and has to know each one's shape to
// read the right inputs back out.
export async function listProfileQuestionsByIds(actor: Member, questionIds: string[]) {
  if (questionIds.length === 0) return [];
  const rows = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        inArray(profileQuestion.id, questionIds),
        isNull(profileQuestion.archivedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  // In the caller's order, and silently dropping ids that don't resolve
  // to a live question in this community — a stale id means there's
  // nothing to answer, not a reason to fail the whole review.
  return questionIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
}

export async function listProfileQuestions(actor: Member, options: { includeArchived?: boolean } = {}) {
  const conditions = [eq(profileQuestion.communityId, actor.communityId)];
  if (!options.includeArchived) {
    conditions.push(isNull(profileQuestion.archivedAt));
  }
  return db
    .select()
    .from(profileQuestion)
    .where(and(...conditions));
}

// Cross-field business rules, enforced here (not just in the zod schema
// above) so a direct lib caller is protected the same way the settings
// action's parse() boundary is — same defense-in-depth precedent as
// tasks/crud.ts's requireEndorsementFields.
function requireValidShape(
  input: Pick<
    CreateProfileQuestionInput,
    | "scope"
    | "phaseNameHint"
    | "responseType"
    | "options"
    | "required"
    | "requiredBy"
    | "allowDeferral"
    | "allowPreferNotToSay"
    | "publishedAsIndicator"
    | "sensitive"
    | "emergencyAccess"
  >,
) {
  if (input.scope === "phase" && !input.phaseNameHint) {
    throw new AppError("phaseNameHint is required when scope is 'phase'");
  }
  if (isChoiceType(input.responseType) && (!input.options || input.options.length === 0)) {
    throw new AppError("options are required for a choice-based response type");
  }
  if (input.requiredBy && !input.required) {
    throw new AppError("A due date only applies to a required question");
  }
  if (input.requiredBy && input.allowDeferral === false) {
    throw new AppError("A due date only applies to a question that can be deferred");
  }
  // Indicators, same defense-in-depth: the settings action's parse()
  // boundary can't express this rule (it spans the response type, the
  // scope and the consent toggle), so it's here where a direct lib
  // caller is protected too.
  assertIndicatorAllowed({
    responseType: input.responseType,
    scope: input.scope,
    allowPreferNotToSay: input.allowPreferNotToSay ?? false,
    publishedAsIndicator: input.publishedAsIndicator ?? false,
  });
  assertNotContradictoryWithPublication({
    sensitive: input.sensitive ?? false,
    emergencyAccess: input.emergencyAccess ?? false,
    publishedAsIndicator: input.publishedAsIndicator ?? false,
  });
  // Sensitive on *create* is refused unconditionally, and that's not an
  // oversight to be tidied away later: a rule can only name a question
  // that already exists, so there is no possible order of operations that
  // creates a sensitive question with a rule attached. The sequence is
  // create it plain, add the access rule, then mark it sensitive — and
  // the settings toggle is disabled until a rule exists so the sequence is
  // discoverable rather than a trap.
  if (input.sensitive) {
    throw new AppError(
      "A question can't be marked sensitive as it is created, because the access rule that protects it has to name the question first. Create it plain, add an access rule for it, then tick sensitive.",
    );
  }
  // Same reasoning, and it falls out of the same impossibility: sensitive
  // can't be set at creation, so neither can emergency, which requires
  // it. One message, because there's one sequence.
  assertEmergencyHasSomethingToOverride({
    emergencyAccess: input.emergencyAccess ?? false,
    sensitive: false,
  });
}

/**
 * Marking a question sensitive requires an access rule to exist.
 *
 * Not decoration. `sensitive` is not a label — it is the thing you must
 * tick *in order to restrict* an answer, and the restriction is performed
 * entirely by the rules. A sensitive question with no rules has an empty
 * audience, which `resolveReadableQuestions` treats as nobody-but-the-owner
 * (it fails closed, and must). So allowing the combination would let an
 * Admin believe they'd narrowed a question to a kitchen team when in fact
 * they'd narrowed it to nobody, and nobody would be able to tell from the
 * settings page.
 */
export async function assertSensitiveAllowed(questionId: string, sensitive: boolean) {
  if (!sensitive) return;
  if ((await countQuestionAccessRules(questionId)) === 0) {
    throw new AppError(
      "Marking a question sensitive is what restricts who can read it, and it does that through an access rule — so it needs one. Add an access rule for this question first, then tick sensitive.",
    );
  }
}

// Every field-shape flag, resolved against the response type it applies
// to. Shared by create (straight off the input) and update (current
// merged with incoming) so neither can grow its own idea of which flags
// are meaningful.
function shapeFrom(input: {
  responseType: ResponseType;
  options?: string[] | null;
  multiline?: boolean | null;
  validation?: TextValidation | null;
  allowOther?: boolean | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
}) {
  return toFieldShape(input);
}

export async function createProfileQuestion(actor: Member, input: CreateProfileQuestionInput) {
  requireValidShape(input);

  const [created] = await db
    .insert(profileQuestion)
    .values({
      communityId: actor.communityId,
      label: input.label,
      responseType: input.responseType,
      // ...and the field-shape flags, with the ones that don't apply to
      // this responseType zeroed in one place (field-shape.ts).
      ...fieldShapeColumnValues(shapeFrom(input)),
      scope: input.scope,
      phaseNameHint: input.scope === "phase" ? input.phaseNameHint : null,
      required: input.required ?? false,
      requiredBy: input.requiredBy ?? null,
      allowDeferral: input.allowDeferral ?? true,
      allowPreferNotToSay: input.allowPreferNotToSay ?? false,
      feedsCapacitySignal: input.feedsCapacitySignal ?? false,
      publishedAsIndicator: input.publishedAsIndicator ?? false,
      sensitive: input.sensitive ?? false,
      emergencyAccess: input.emergencyAccess ?? false,
      surfaces: input.surfaces ?? [],
    })
    .returning();
  return created;
}

export async function updateProfileQuestion(
  actor: Member,
  questionId: string,
  input: UpdateProfileQuestionInput,
) {
  const [current] = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)));
  if (!current) {
    throw new NotFoundError("Profile question not found");
  }

  // Same cross-field check createProfileQuestion's requireValidShape
  // enforces, re-derived against the *effective* (current merged with
  // incoming) shape, since an update can change responseType without
  // resending options or vice versa.
  const effectiveResponseType = input.responseType ?? current.responseType;
  if (isChoiceType(effectiveResponseType) && (input.options ?? current.options).length === 0) {
    throw new AppError("options are required for a choice-based response type");
  }

  // Publishing, and *staying* published, are checked against the
  // effective state — because an update can change the response type
  // without ever mentioning indicators, and the result would be a
  // published written-answer question the aggregate can't render.
  //
  // Two distinct refusals with two distinct messages, because they are
  // two different mistakes. The first is an admin editing a published
  // question's type; the second is an admin asking to publish something
  // that can't be aggregated, where the fix is to change the type first.
  // Letting the first fall through to the second's wording would tell
  // someone to "change the answer type to pick one, pick any, a date or
  // a number" when what they actually did was retitle a question.
  //
  // Both reject rather than quietly clearing the flag, which is the
  // opposite of how a stale min/max is handled below. Clearing would mean
  // an admin editing an unrelated dropdown makes a community-chosen
  // disclosure vanish from /community with no message. A refusal that
  // names the fix — unpublish, change the type, republish — is one click
  // more and doesn't hide the decision.
  const effectivePublished = input.publishedAsIndicator ?? current.publishedAsIndicator;
  // …and the consent toggle is part of the effective state too, because
  // un-ticking "prefer not to say" on a published question is the same
  // class of edit as retitling it into something unpublishable: it would
  // leave a standing number on /community that members can no longer
  // decline to be counted in. The one difference is the fix, so the
  // message below names the box rather than the sequence.
  const effectiveAllowPreferNotToSay =
    input.allowPreferNotToSay ?? current.allowPreferNotToSay;
  const effectiveBlocker = indicatorBlocker({
    responseType: effectiveResponseType,
    scope: current.scope,
    allowPreferNotToSay: effectiveAllowPreferNotToSay,
  });
  if (effectiveBlocker && current.publishedAsIndicator && input.publishedAsIndicator !== false) {
    throw new AppError(
      `This question is published as a community indicator, and ${effectiveBlocker.reason}. Unpublish it first, make the change, then publish it again.`,
    );
  }
  assertIndicatorAllowed({
    responseType: effectiveResponseType,
    scope: current.scope,
    allowPreferNotToSay: effectiveAllowPreferNotToSay,
    publishedAsIndicator: effectivePublished,
  });
  // Same defense-in-depth for the other contradiction, and against the
  // *effective* pair rather than the submitted one: ticking emergency on
  // a published question has to be refused, and so does publishing one
  // that was already emergency-marked. Either way the question ends up
  // both, and it's checked before the write so it never exists.
  assertNotContradictoryWithPublication({
    sensitive: input.sensitive ?? current.sensitive,
    emergencyAccess: input.emergencyAccess ?? current.emergencyAccess,
    publishedAsIndicator: effectivePublished,
  });
  // Ahead of the rule-count check below, deliberately, because for a
  // question that has neither flag the two messages are about the same
  // underlying gap and "mark it sensitive first" is the more informative
  // one — it names the step that comes next rather than the mechanism.
  assertEmergencyHasSomethingToOverride({
    emergencyAccess: input.emergencyAccess ?? current.emergencyAccess,
    sensitive: input.sensitive ?? current.sensitive,
  });
  // Only when sensitive is *being turned on*. Un-ticking it is always
  // allowed, and a question that was somehow already sensitive with no
  // rules must be able to have that fixed — refusing here would trap an
  // admin in a state they can only leave by deleting the question.
  if (input.sensitive === true && !current.sensitive) {
    await assertSensitiveAllowed(questionId, true);
  }

  // Every field-shape flag, resolved against the effective response type
  // and then zeroed where it no longer applies — so switching a question
  // from a number to a single_choice clears its stale min/max/step, and
  // one from text to date clears its multiline/validation, in the same
  // way the builder does client-side. Only written when the update
  // actually touched the shape, so a label-only save doesn't rewrite
  // these columns.
  const shapeTouched =
    input.responseType !== undefined ||
    input.options !== undefined ||
    input.multiline !== undefined ||
    input.validation !== undefined ||
    input.allowOther !== undefined ||
    input.min !== undefined ||
    input.max !== undefined ||
    input.step !== undefined;
  const finalShape = shapeTouched
    ? fieldShapeColumnValues(
        shapeFrom({
          responseType: effectiveResponseType,
          options: input.options ?? current.options,
          multiline: input.multiline ?? current.multiline,
          validation: input.validation ?? (current.validation as TextValidation),
          allowOther: input.allowOther ?? current.allowOther,
          min: input.min !== undefined ? input.min : current.min,
          max: input.max !== undefined ? input.max : current.max,
          step: input.step !== undefined ? input.step : current.step,
        }),
      )
    : null;

  // Turning required off in the same submit that would leave a due date
  // behind clears the date too, rather than storing a setting that does
  // nothing (same shape as finalOptions above).
  const effectiveRequired = input.required ?? current.required;
  const effectiveAllowDeferral = input.allowDeferral ?? current.allowDeferral;
  // A due date only means something on a required, deferrable question.
  // Turning either of those off in the same submit clears the date rather
  // than rejecting the save — otherwise un-ticking "allow I don't know
  // yet" on a question that has a due date would be impossible to save,
  // since the date input is still on the page submitting it. Same shape
  // as finalOptions above.
  const submittedRequiredBy = input.requiredBy !== undefined ? input.requiredBy : current.requiredBy;
  const finalRequiredBy = effectiveRequired && effectiveAllowDeferral ? submittedRequiredBy : null;

  const [updated] = await db
    .update(profileQuestion)
    .set({
      ...(input.label !== undefined && { label: input.label }),
      ...(input.responseType !== undefined && { responseType: input.responseType }),
      ...(finalShape ?? {}),
      ...(input.required !== undefined && { required: input.required }),
      ...(input.requiredBy !== undefined && { requiredBy: finalRequiredBy }),
      ...(input.requiredBy === undefined &&
        current.requiredBy !== null &&
        finalRequiredBy === null && { requiredBy: null }),
      ...(input.allowDeferral !== undefined && { allowDeferral: input.allowDeferral }),
      ...(input.allowPreferNotToSay !== undefined && { allowPreferNotToSay: input.allowPreferNotToSay }),
      ...(input.publishedAsIndicator !== undefined && {
        publishedAsIndicator: input.publishedAsIndicator,
      }),
      ...(input.sensitive !== undefined && { sensitive: input.sensitive }),
      ...(input.emergencyAccess !== undefined && {
        emergencyAccess: input.emergencyAccess,
      }),
      ...(input.feedsCapacitySignal !== undefined && {
        feedsCapacitySignal: input.feedsCapacitySignal,
      }),
      ...(input.surfaces !== undefined && { surfaces: input.surfaces }),
    })
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Profile question not found");
  }

  return updated;
}

// Archive, not delete — "an archived_at so a retired question's past
// answers survive" (spec). ProfileAnswer rows keep pointing at a real
// question either way.
export async function archiveProfileQuestion(actor: Member, questionId: string) {
  const [updated] = await db
    .update(profileQuestion)
    .set({ archivedAt: new Date() })
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Profile question not found");
  }
  return updated;
}

export async function unarchiveProfileQuestion(actor: Member, questionId: string) {
  const [updated] = await db
    .update(profileQuestion)
    .set({ archivedAt: null })
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Profile question not found");
  }
  return updated;
}
