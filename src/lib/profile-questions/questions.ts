import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profileAnswer, profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import {
  createSensitiveFieldAccessRule,
  createSensitiveFieldAccessRuleInput,
} from "../sensitive-data";
import {
  assertEmergencyHasSomethingToOverride,
  assertIndicatorAllowed,
  assertNotContradictoryWithPublication,
  indicatorBlocker,
} from "./indicators";
import {
  RESPONSE_TYPES,
  TEXT_VALIDATIONS,
  fieldShapeColumnValues,
  isChoiceType,
  toFieldShape,
  type ResponseType,
  type TextValidation,
} from "../field-shape";
import { recordSettingChanges } from "../settings/history";

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
    //
    // `sensitive` is the one attribute that is *fixed at creation* and has
    // no `update` counterpart anywhere in this file. See the note on
    // updateProfileQuestion for why.
    sensitive: z.boolean().optional(),
    // The audience for a sensitive question, supplied at creation and
    // applied by createProfileQuestion in the only order that works: the
    // question has to exist before a rule can name it. Passing `sensitive`
    // without one of these is refused, and so is an audience on a question
    // that isn't sensitive.
    audience: createSensitiveFieldAccessRuleInput
      .omit({ questionId: true })
      .optional(),
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
    // A sensitive question is restricted by an audience, so the two are
    // one decision and a half of either is refused. Not decoration: a
    // sensitive question with no audience resolves to nobody-but-the-owner
    // on the read side, so accepting one silently would hand an admin who
    // believed they'd restricted a question to the kitchen an answer
    // nobody can see. And an audience on a public question is a rule
    // restricting nothing, which is worse than useless because it looks
    // like it is doing something on the settings page.
    if (input.sensitive && !input.audience) {
      ctx.addIssue({
        code: "custom",
        message: "a sensitive question needs an audience",
        path: ["audience"],
      });
    }
    if (!input.sensitive && input.audience) {
      ctx.addIssue({
        code: "custom",
        message: "an audience restricts a sensitive question, so this one isn't sensitive",
        path: ["audience"],
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
    // NO `sensitive` here, and that absence is the whole mechanism.
    //
    // It was a toggle for as long as it was an attribute, on the
    // reasoning that a non-sensitive question defaults to readable by
    // everyone so under-labelling publishes — which is true about
    // *choosing* at creation and says nothing about *changing* one later.
    // Un-ticking it on a question that has answers makes every one of
    // them world-readable, for members who answered when only a kitchen
    // team could see it, and no amount of copy makes that a setting
    // rather than a disclosure. So the flag is fixed where the question
    // is created and is unrepresentable in an update — not refused by a
    // runtime check, absent from the type.
    //
    // The remedy for a mis-filed question is the one this codebase already
    // has for questions in general: archive it and add it again, which
    // leaves the old answers attached to the old question rather than
    // reinterpreting them.
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
    | "audience"
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
  // Emergency access reveals an answer to whoever activates emergency mode,
  // so it needs something to override — a restriction. Same reasoning the
  // old create-time refusal used to drag in, now stated on its own terms
  // and with the audience available.
  assertEmergencyHasSomethingToOverride({
    emergencyAccess: input.emergencyAccess ?? false,
    sensitive: input.sensitive ?? false,
  });
  // The audience and the flag are one decision, checked here as well as in
  // the zod schema — same defense-in-depth reason as the assertions above,
  // and for the same caller: a direct lib caller, or an action that hands
  // over an object rather than a parse.
  //
  // Both directions, because both are the same mistake pointed the other
  // way. A flag with no audience resolves to nobody-but-the-owner, so an
  // Admin who believed they'd restricted a question to the kitchen would
  // have restricted it to a state that reads as broken. An audience with
  // no flag restricts nothing at all and looks on the settings page like
  // it's doing something.
  const routes = [
    input.audience?.unlockedByTaskId,
    input.audience?.unlockedByTierId,
    input.audience?.unlockedByGrantModuleKey,
  ].filter(Boolean).length;
  if (input.sensitive && routes === 0) {
    throw new AppError(
      "A sensitive question needs an audience: it's what restricts it. Pick a group, or leave the question readable by the whole Community.",
    );
  }
  if (!input.sensitive && routes > 0) {
    throw new AppError(
      "An audience only restricts a sensitive question, and this one isn't sensitive — so the rule you picked would read nothing the Community doesn't already read.",
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

  // A sensitive question is created in the only order that works: the row
  // first, because a rule can only name a question that exists, then the
  // rule, then the flag. This used to be impossible from outside — create
  // refused `sensitive` outright and the settings box was disabled until
  // a rule existed, so a restricted question could only be made by the
  // seeder's three separate calls. Doing it here makes the create path
  // and the settings form and the starter set one operation instead of
  // three, and removes a dead end from the UI.
  // The insert and its log row are one transaction — see
  // recordSettingChanges on why a log written outside the write is worse
  // than no log. The sensitive path below continues after it, deliberately:
  // createSensitiveFieldAccessRule is a separate operation with its own
  // log row, and the question it names has to exist before that call can
  // succeed at all.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
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
        // Written false and set below, so the flag and the rule it depends
        // on can never disagree — including if the rule insert throws.
        sensitive: false,
        emergencyAccess: false,
        surfaces: input.surfaces ?? [],
      })
      .returning();

    // Logged inside this transaction rather than at the end of the
    // function because a sensitive question takes a second path below (rule
    // insert, then an update to set the flag), and one create with one log
    // row beats two rows describing one decision. The audience's own fields
    // are logged by createSensitiveFieldAccessRule, so the two rows together
    // read as the whole change.
    await recordSettingChanges(tx, {
      actor,
      entity: "profile_question",
      action: "created",
      entityId: row.id,
      entityLabel: row.label,
      current: {},
      changes: {
        label: row.label,
        responseType: row.responseType,
        scope: row.scope,
        required: row.required,
        requiredBy: row.requiredBy,
        allowDeferral: row.allowDeferral,
        allowPreferNotToSay: row.allowPreferNotToSay,
        publishedAsIndicator: row.publishedAsIndicator,
        // From the *input*, not the row: the row says false here because
        // the sensitive path hasn't run yet, and "restricted: off" on a
        // question that is about to be restricted would be a lie.
        sensitive: input.sensitive ?? false,
        emergencyAccess: input.emergencyAccess ?? false,
        options: row.options,
      },
    });
    return row;
  });

  if (!input.sensitive) return created;

  const rule = await createSensitiveFieldAccessRule(actor, {
    ...input.audience!,
    questionId: created.id,
  });
  // One last UPDATE rather than an amend of the insert above, because the
  // rule needs the id and the id only exists after the insert.
  const [finished] = await db
    .update(profileQuestion)
    .set({
      sensitive: true,
      emergencyAccess: input.emergencyAccess ?? false,
    })
    .where(eq(profileQuestion.id, created.id))
    .returning();
  void rule;
  return finished;
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
    // `current.sensitive`, never an incoming value: the flag is fixed at
    // creation, so an update cannot move it and these checks are about the
    // question as it already is.
    sensitive: current.sensitive,
    emergencyAccess: input.emergencyAccess ?? current.emergencyAccess,
    publishedAsIndicator: effectivePublished,
  });
  assertEmergencyHasSomethingToOverride({
    emergencyAccess: input.emergencyAccess ?? current.emergencyAccess,
    sensitive: current.sensitive,
  });
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

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
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
        ...(input.allowPreferNotToSay !== undefined && {
          allowPreferNotToSay: input.allowPreferNotToSay,
        }),
        ...(input.publishedAsIndicator !== undefined && {
          publishedAsIndicator: input.publishedAsIndicator,
        }),
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
    if (!row) {
      throw new NotFoundError("Profile question not found");
    }

    // The label is taken *after* the write, so a rename logs against the
    // question's new name and "label: old → new" reads in one line rather
    // than leaving the reader to work out which question it was. `options`
    // is included because changing a dropdown's choices without touching its
    // label is a real edit that would otherwise be invisible.
    await recordSettingChanges(tx, {
      actor,
      entity: "profile_question",
      action: "updated",
      entityId: questionId,
      entityLabel: row.label,
      current,
      changes: {
        label: input.label,
        responseType: input.responseType,
        required: input.required,
        requiredBy: input.requiredBy,
        allowDeferral: input.allowDeferral,
        allowPreferNotToSay: input.allowPreferNotToSay,
        publishedAsIndicator: input.publishedAsIndicator,
        emergencyAccess: input.emergencyAccess,
        feedsCapacitySignal: input.feedsCapacitySignal,
        surfaces: input.surfaces,
        options: input.options,
        multiline: input.multiline,
        validation: input.validation,
        allowOther: input.allowOther,
        min: input.min,
        max: input.max,
        step: input.step,
      },
    });
    return row;
  });

  // Turning emergency access ON is a widening, and it is the only widening
  // in this function — everything else it writes is the Community changing
  // its own posture, which nobody else's answers are subject to.
  //
  // So every answer that already exists has its emergency consent reset.
  // Those people answered a question their data could not be pulled out of
  // in a crisis, and the reach is now being handed to whoever activates
  // emergency mode on their page, which they were not asked about. They get
  // a prompt on their profile instead, and the reach arrives when they say
  // yes. Leaving the consents alone instead would convert "nobody was
  // asked" into "everyone agreed" without a word to anybody, which is the
  // same failure `profile_answer_rule_consent` was added to stop for
  // audiences.
  //
  // Deliberately keyed on the *transition*, not on the incoming value: an
  // Admin turning it off discloses nothing, so nobody's consent moves, and
  // turning it back on later asks again. Re-granting a reach deserves a
  // fresh answer even though nothing about the answers changed.
  //
  // The two exclusions are the ones where nothing actually widens. An
  // answer that already un-ticked `shareWithAudience` is emergency-only by
  // that choice, so asking again would be asking about a reach they chose.
  // And a decline or a deferral holds no value, so there is nothing to
  // reach — the same filter `listEmergencyAnswers` applies.
  if (input.emergencyAccess === true && !current.emergencyAccess) {
    await db
      .update(profileAnswer)
      .set({ emergencyConsent: false })
      .where(
        and(
          eq(profileAnswer.questionId, questionId),
          eq(profileAnswer.status, "answered"),
          eq(profileAnswer.shareWithAudience, true),
        ),
      );
  }

  return updated;
}

// Archive, not delete — "an archived_at so a retired question's past
// answers survive" (spec). ProfileAnswer rows keep pointing at a real
// question either way.
export async function archiveProfileQuestion(actor: Member, questionId: string) {
  return setProfileQuestionArchived(actor, questionId, true, "archived");
}

export async function unarchiveProfileQuestion(actor: Member, questionId: string) {
  return setProfileQuestionArchived(actor, questionId, false, "unarchived");
}

async function setProfileQuestionArchived(
  actor: Member,
  questionId: string,
  archived: boolean,
  action: "archived" | "unarchived",
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(profileQuestion)
      .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)));
    if (!before) {
      throw new NotFoundError("Profile question not found");
    }

    const [row] = await tx
      .update(profileQuestion)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)))
      .returning();

    await recordSettingChanges(tx, {
      actor,
      entity: "profile_question",
      action,
      entityId: questionId,
      entityLabel: row.label,
      current: before,
      changes: { archivedAt: row.archivedAt },
    });
    return row;
  });
}
