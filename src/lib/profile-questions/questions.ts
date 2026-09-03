import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

const responseTypes = ["free_text", "single_choice", "multi_choice", "date"] as const;
const scopes = ["once_ever", "per_cycle", "phase"] as const;

// Standing community structure — gated by requireAdmins at the settings
// action layer (src/app/settings/actions.ts), the same split Branch/Tier
// CRUD already uses: this module stays community-scoped only.
export const createProfileQuestionInput = z
  .object({
    label: z.string().min(1),
    responseType: z.enum(responseTypes),
    options: z.array(z.string().min(1)).optional(),
    scope: z.enum(scopes),
    phaseNameHint: z.string().min(1).nullable().optional(),
    required: z.boolean().optional(),
    feedsCapacitySignal: z.boolean().optional(),
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
    if (
      (input.responseType === "single_choice" || input.responseType === "multi_choice") &&
      (!input.options || input.options.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "options are required for a choice-based response type",
        path: ["options"],
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
export const updateProfileQuestionInput = z.object({
  label: z.string().min(1).optional(),
  responseType: z.enum(responseTypes).optional(),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
  feedsCapacitySignal: z.boolean().optional(),
  surfaces: z.array(z.string().min(1)).optional(),
});
export type UpdateProfileQuestionInput = z.infer<typeof updateProfileQuestionInput>;

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
function requireValidShape(input: Pick<CreateProfileQuestionInput, "scope" | "phaseNameHint" | "responseType" | "options">) {
  if (input.scope === "phase" && !input.phaseNameHint) {
    throw new AppError("phaseNameHint is required when scope is 'phase'");
  }
  if (
    (input.responseType === "single_choice" || input.responseType === "multi_choice") &&
    (!input.options || input.options.length === 0)
  ) {
    throw new AppError("options are required for a choice-based response type");
  }
}

export async function createProfileQuestion(actor: Member, input: CreateProfileQuestionInput) {
  requireValidShape(input);

  const [created] = await db
    .insert(profileQuestion)
    .values({
      communityId: actor.communityId,
      label: input.label,
      responseType: input.responseType,
      options: input.options ?? [],
      scope: input.scope,
      phaseNameHint: input.scope === "phase" ? input.phaseNameHint : null,
      required: input.required ?? false,
      feedsCapacitySignal: input.feedsCapacitySignal ?? false,
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
  const effectiveOptions = input.options ?? current.options;
  const isChoiceType = effectiveResponseType === "single_choice" || effectiveResponseType === "multi_choice";
  if (isChoiceType && effectiveOptions.length === 0) {
    throw new AppError("options are required for a choice-based response type");
  }
  // Stale options from a since-abandoned choice type shouldn't linger
  // on the row — the same "clear options once the field stops being
  // choice-based" call the builder itself makes client-side.
  const finalOptions = isChoiceType ? effectiveOptions : [];

  const [updated] = await db
    .update(profileQuestion)
    .set({
      ...(input.label !== undefined && { label: input.label }),
      ...(input.responseType !== undefined && { responseType: input.responseType }),
      ...((input.responseType !== undefined || input.options !== undefined) && { options: finalOptions }),
      ...(input.required !== undefined && { required: input.required }),
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
