import { z } from "zod";
import { db } from "@/db";
import { assemblyQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError } from "../errors";
import { requireAssemblyInCommunity } from "./crud";
import { computeAssemblyPhase } from "./phase";

type Member = typeof memberTable.$inferSelect;

const responseTypes = ["free_text", "single_choice", "multi_choice"] as const;

export const addAgendaItemInput = z
  .object({
    text: z.string().min(1),
    responseType: z.enum(responseTypes).optional(),
    options: z.array(z.string().min(1)).optional(),
  })
  .superRefine((input, ctx) => {
    const responseType = input.responseType ?? "free_text";
    if (
      (responseType === "single_choice" || responseType === "multi_choice") &&
      (!input.options || input.options.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "options are required for a choice-based response type",
        path: ["options"],
      });
    }
  });
export type AddAgendaItemInput = z.infer<typeof addAgendaItemInput>;

// "Once proposed, a configurable window lets anyone add items to it
// (the agenda-building phase)" — same open-access, no-approval
// posting as Input rounds' questions, just windowed to the agenda
// phase specifically rather than open indefinitely.
export async function addAgendaItem(actor: Member, assemblyId: string, input: AddAgendaItemInput) {
  const a = await requireAssemblyInCommunity(actor, assemblyId);
  if (computeAssemblyPhase(a) !== "agenda") {
    throw new ConflictError("The agenda-building window for this Assembly has closed");
  }

  const responseType = input.responseType ?? "free_text";
  if (
    (responseType === "single_choice" || responseType === "multi_choice") &&
    (!input.options || input.options.length === 0)
  ) {
    throw new AppError("options are required for a choice-based response type");
  }

  const [created] = await db
    .insert(assemblyQuestion)
    .values({
      assemblyId,
      addedBy: actor.id,
      text: input.text,
      responseType,
      options: input.options ?? [],
    })
    .returning();
  return created;
}
