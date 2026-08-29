import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, form, formResponse, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

const responseTypes = ["free_text", "single_choice", "multi_choice"] as const;

const formFieldInput = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  responseType: z.enum(responseTypes),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
});
export type FormField = z.infer<typeof formFieldInput>;

// A community-defined set of fields with a stated purpose — shared
// infrastructure, not a module. See docs/spec.md's "Forms". Gated the
// same way Sensitive data's access rules are (Phase 22): requireAdmins
// at the Server Action/API layer (not inside this module), since
// defining what data gets collected from members is a real
// configuration decision, not an open one.
export const createFormInput = z
  .object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    fields: z.array(formFieldInput).min(1),
    allowAnonymous: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    input.fields.forEach((f, i) => {
      if (
        (f.responseType === "single_choice" || f.responseType === "multi_choice") &&
        (!f.options || f.options.length === 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "options are required for a choice-based response type",
          path: ["fields", i, "options"],
        });
      }
    });
    const keys = input.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "field keys must be unique", path: ["fields"] });
    }
  });
export type CreateFormInput = z.infer<typeof createFormInput>;

// Cross-field business rules, re-checked here (not just in the zod
// schema above) so a direct lib caller is protected the same way the
// settings action's parse() boundary is — same defense-in-depth
// precedent as profile-questions/questions.ts's requireValidShape.
function requireValidFields(fields: FormField[]) {
  for (const f of fields) {
    if ((f.responseType === "single_choice" || f.responseType === "multi_choice") && (!f.options || f.options.length === 0)) {
      throw new AppError("options are required for a choice-based response type");
    }
  }
  const keys = fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    throw new AppError("field keys must be unique");
  }
}

export async function createForm(actor: Member, input: CreateFormInput) {
  requireValidFields(input.fields);

  const [created] = await db
    .insert(form)
    .values({
      communityId: actor.communityId,
      title: input.title,
      description: input.description ?? null,
      fields: input.fields,
      allowAnonymous: input.allowAnonymous ?? false,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// Title/description only — fields and allowAnonymous stay fixed after
// creation, the same "structural shape doesn't change underneath
// existing answers" posture ProfileQuestion already takes (only
// label/required are editable there too).
export const updateFormInput = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormInput>;

export async function updateForm(actor: Member, formId: string, input: UpdateFormInput) {
  const [updated] = await db
    .update(form)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
    })
    .where(and(eq(form.id, formId), eq(form.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Form not found");
  }
  return updated;
}

// Archive, not delete — past responses stay attached to a real form.
export async function archiveForm(actor: Member, formId: string) {
  const [updated] = await db
    .update(form)
    .set({ archivedAt: new Date() })
    .where(and(eq(form.id, formId), eq(form.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Form not found");
  }
  return updated;
}

export async function unarchiveForm(actor: Member, formId: string) {
  const [updated] = await db
    .update(form)
    .set({ archivedAt: null })
    .where(and(eq(form.id, formId), eq(form.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Form not found");
  }
  return updated;
}

export async function listForms(actor: Member, options: { includeArchived?: boolean } = {}) {
  const conditions = [eq(form.communityId, actor.communityId)];
  if (!options.includeArchived) {
    conditions.push(isNull(form.archivedAt));
  }
  return db
    .select()
    .from(form)
    .where(and(...conditions));
}

export async function getForm(actor: Member, formId: string) {
  const [row] = await db
    .select()
    .from(form)
    .where(and(eq(form.id, formId), eq(form.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Form not found");
  }
  return row;
}

// Submission is all-or-nothing against the form's field definitions —
// required fields block the whole submission — the real behavioral
// line spec draws between a Form and a Question (always independently
// optional to answer).
export const submitFormResponseInput = z.object({
  values: z.record(z.string(), z.unknown()),
  anonymous: z.boolean().optional(),
});
export type SubmitFormResponseInput = z.infer<typeof submitFormResponseInput>;

function isBlank(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export async function submitFormResponse(actor: Member, formId: string, input: SubmitFormResponseInput) {
  const formRow = await getForm(actor, formId);
  if (formRow.archivedAt) {
    throw new ConflictError("This form is no longer accepting responses");
  }

  const fields = formRow.fields as FormField[];
  for (const f of fields) {
    if (f.required && isBlank(input.values[f.key])) {
      throw new AppError(`"${f.label}" is required`);
    }
  }

  const submittedBy = input.anonymous && formRow.allowAnonymous ? null : actor.id;

  const [created] = await db
    .insert(formResponse)
    .values({ formId, submittedBy, values: input.values })
    .returning();
  return created;
}

// Public — no actor, since "applying is the one Form use case that
// has to work before someone's a Member at all" (docs/development-
// plan.md's Phase 33). Deliberately not just submitFormResponse with a
// looser gate: there's no actor to attribute the response to at all,
// not even optionally (submittedBy is always null here, regardless of
// the form's allowAnonymous setting — that flag governs an
// *authenticated* member's choice to hide their identity, a different
// question from "there was never a Member session to begin with").
// Callers are responsible for restricting which formId this can ever
// be invoked against — see src/lib/recruitment/applications.ts's
// submitRecruitmentApplication, the only intended caller, which always
// resolves the id itself from Community.recruitmentApplicationFormId
// rather than accepting one from request input.
export async function submitPublicFormResponse(formId: string, input: SubmitFormResponseInput) {
  const [formRow] = await db.select().from(form).where(eq(form.id, formId));
  if (!formRow) {
    throw new NotFoundError("Form not found");
  }
  if (formRow.archivedAt) {
    throw new ConflictError("This form is no longer accepting responses");
  }

  const fields = formRow.fields as FormField[];
  for (const f of fields) {
    if (f.required && isBlank(input.values[f.key])) {
      throw new AppError(`"${f.label}" is required`);
    }
  }

  const [created] = await db
    .insert(formResponse)
    .values({ formId, submittedBy: null, values: input.values })
    .returning();
  return created;
}

// Community-scoped only — Forms itself stays unopinionated about who
// may read responses; that's a policy each consumer defines for
// itself (see the post-cycle feedback functions below, which layer
// feedbackReviewTaskId gating on top of this).
export async function listFormResponses(actor: Member, formId: string) {
  await getForm(actor, formId);
  return db.select().from(formResponse).where(eq(formResponse.formId, formId));
}

// --- Post-cycle feedback: Forms' first real, non-Recruitment consumer ---
// See docs/spec.md's "Forms" ("a post-cycle feedback survey is a
// Form") and docs/development-plan.md's Phase 25.

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

async function isFeedbackReviewHolder(actor: Member): Promise<boolean> {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.feedbackReviewTaskId) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, communityRow.feedbackReviewTaskId),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function getPostCycleFeedbackForm(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.postCycleFeedbackFormId) return null;
  return getForm(actor, communityRow.postCycleFeedbackFormId);
}

export async function submitPostCycleFeedback(actor: Member, input: SubmitFormResponseInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.postCycleFeedbackFormId) {
    throw new AppError("No post-cycle feedback form is configured for this Community yet");
  }
  return submitFormResponse(actor, communityRow.postCycleFeedbackFormId, input);
}

// Only the feedback-review task's current holder sees responses —
// same "the task is the authority" gate Conflict management's own
// pointer field established.
export async function listPostCycleFeedbackResponses(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.postCycleFeedbackFormId) {
    return [];
  }
  if (!(await isFeedbackReviewHolder(actor))) {
    throw new ForbiddenError("Only the current feedback-review task holder can see responses");
  }
  return listFormResponses(actor, communityRow.postCycleFeedbackFormId);
}
