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

export const updateProfileQuestionInput = z.object({
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
  feedsCapacitySignal: z.boolean().optional(),
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
    })
    .returning();
  return created;
}

export async function updateProfileQuestion(
  actor: Member,
  questionId: string,
  input: UpdateProfileQuestionInput,
) {
  const [updated] = await db
    .update(profileQuestion)
    .set({
      ...(input.label !== undefined && { label: input.label }),
      ...(input.required !== undefined && { required: input.required }),
      ...(input.feedsCapacitySignal !== undefined && {
        feedsCapacitySignal: input.feedsCapacitySignal,
      }),
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
