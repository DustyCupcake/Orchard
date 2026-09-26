import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assemblyQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  RESPONSE_TYPES,
  TEXT_VALIDATIONS,
  fieldShapeColumnValues,
  isChoiceType,
  toFieldShape,
} from "../field-shape";
import { requireAssemblyInCommunity } from "./crud";
import { computeAssemblyPhase } from "./phase";

type Member = typeof memberTable.$inferSelect;

// The same six types as every other question system, from the same list
// — see src/lib/field-shape.ts. This was a third local copy of a
// three-value list. `AssemblyResponseType` stays exported from here
// because founding-settings.ts's template item type names it, but it's
// now an alias of the shared union rather than a lookalike that can
// drift out of step with the four other systems.
export type { ResponseType as AssemblyResponseType } from "../field-shape";
export { isChoiceType } from "../field-shape";

// Options arrive from three different places — the agenda form, the
// JSON API, and template seeding — so they're normalised in one place
// rather than at each call site. Two rules, both earned the hard way by
// the original comma-separated text field this replaced:
//
//   - trim, and drop blanks. A half-typed list ("yes, , no, ") used to
//     commit its empty strings as real options, which then rendered as
//     blank rows in the tally and unselectable empty radios.
//   - reject duplicates. Two options with identical text produce two
//     radios sharing one name AND one value, so the browser treats them
//     as a single control and checking one visually checks both, while
//     the tally counts them as two separate answers. Worse than a
//     cosmetic bug — it silently misreports the result.
//
// addAgendaItem re-applies this rather than trusting its caller to have
// run it: it already refuses to store a choice item with no options
// (addAgendaItemInput is only parsed at the action/API boundary, not
// inside this function), so a raw insert straight into the lib would
// otherwise get weaker guarantees than one through the form.
export function normalizeOptions(raw: string[]): string[] {
  return raw.map((o) => o.trim()).filter((o) => o.length > 0);
}

export function findDuplicateOption(options: string[]): string | null {
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option)) return option;
    seen.add(option);
  }
  return null;
}

const optionsSchema = z
  .array(z.string())
  .transform(normalizeOptions)
  .refine((opts) => findDuplicateOption(opts) === null, {
    message: "options must be distinct — two of them are worded the same",
  })
  .optional();

export const addAgendaItemInput = z
  .object({
    // Trimmed before the length check, so a whitespace-only item can no
    // longer pass as a real one.
    text: z.string().trim().min(1, "an agenda item needs some text"),
    responseType: z.enum(RESPONSE_TYPES).optional(),
    options: optionsSchema,
    multiline: z.boolean().optional(),
    validation: z.enum(TEXT_VALIDATIONS).optional(),
    allowOther: z.boolean().optional(),
    min: z.number().int().nullable().optional(),
    max: z.number().int().nullable().optional(),
    step: z.number().int().nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (isChoiceType(input.responseType ?? "text") && (!input.options || input.options.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "options are required for a choice-based response type",
        path: ["options"],
      });
    }
  });
export type AddAgendaItemInput = z.input<typeof addAgendaItemInput>;

// "Once proposed, a configurable window lets anyone add items to it
// (the agenda-building phase)" — same open-access, no-approval
// posting as Input rounds' questions, just windowed to the agenda
// phase specifically rather than open indefinitely.
export async function addAgendaItem(
  actor: Member,
  assemblyId: string,
  input: AddAgendaItemInput,
) {
  const a = await requireAssemblyInCommunity(actor, assemblyId);
  if (computeAssemblyPhase(a) !== "agenda") {
    throw new ConflictError("The agenda-building window for this Assembly has closed");
  }

  const responseType = input.responseType ?? "text";
  const normalized = normalizeOptions(input.options ?? []);
  if (isChoiceType(responseType) && normalized.length === 0) {
    throw new AppError("options are required for a choice-based response type");
  }
  const dupe = findDuplicateOption(normalized);
  if (dupe !== null) {
    throw new AppError(`"${dupe}" is listed twice — options must be distinct`);
  }

  // A non-choice question never carries options. The agenda form used to
  // keep its options field on screen at all times, so the natural
  // sequence — type the options, then switch the response type to a
  // written answer — committed an item whose options could never be
  // displayed, voted on, or edited again. Dropping them here means a
  // response type is the single thing that decides whether an item has
  // options at all.

  const [created] = await db
    .insert(assemblyQuestion)
    .values({
      assemblyId,
      addedBy: actor.id,
      text: input.text,
      responseType,
      // Field-shape flags, with the ones that don't apply to this type
      // zeroed in one place — same rule as every other question system.
      ...fieldShapeColumnValues(
        toFieldShape({
          responseType,
          options: normalized,
          multiline: input.multiline ?? true,
          validation: input.validation,
          allowOther: input.allowOther,
          min: input.min,
          max: input.max,
          step: input.step,
        }),
      ),
    })
    .returning();
  return created;
}

/**
 * Withdrawing an agenda item you added.
 *
 * Adding to an agenda is deliberately open to anyone (no approval
 * step), which means the same openness has to include taking back
 * something you added — a typo, a motion worded badly, an item that
 * turns out to be two questions wearing a trenchcoat. Without it, the
 * agenda is append-only for its whole window and a mistake is visible
 * to the entire community until the phase rolls over, with no way for
 * the person who made it to fix it.
 *
 * Your own items only. Someone else's item is theirs to withdraw; the
 * answer to "this shouldn't be on the agenda" is for whoever proposed
 * the Assembly to run another one, not for every member to be able to
 * delete other people's questions. Deliberately not modelled as a
 * moderation power — nothing in the spec grants one, and an Assembly
 * with no gatekeeping shouldn't quietly grow a delete button.
 */
export async function removeAgendaItem(actor: Member, questionId: string) {
  const [q] = await db
    .select()
    .from(assemblyQuestion)
    .where(eq(assemblyQuestion.id, questionId));
  if (!q) {
    throw new NotFoundError("Agenda item not found");
  }
  if (q.addedBy !== actor.id) {
    throw new ForbiddenError("You can only withdraw an agenda item you added yourself");
  }

  const a = await requireAssemblyInCommunity(actor, q.assemblyId);
  if (computeAssemblyPhase(a) !== "agenda") {
    throw new ConflictError("The agenda-building window for this Assembly has closed");
  }

  // Responses cascade with the question, which is safe precisely
  // because nothing can have responded yet: voting hasn't opened.
  await db.delete(assemblyQuestion).where(eq(assemblyQuestion.id, questionId));
}
