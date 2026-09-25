import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { foodIdea } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { getMenuPlan, getVisibleMenuPlan, requireEditableMenuPlan, requireKitchenModuleOn } from "./menu";

type Member = typeof memberTable.$inferSelect;

export const fileFoodIdeaInput = z.object({
  menuPlanId: z.string().uuid(),
  kind: z.enum(["recipe_suggestion", "dish_request", "preference"]),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
});
export type FileFoodIdeaInput = z.infer<typeof fileFoodIdeaInput>;

export const declineFoodIdeaInput = z.object({
  declinedReason: z.string().nullable().optional(),
});
export type DeclineFoodIdeaInput = z.infer<typeof declineFoodIdeaInput>;

// D5's open door — "Members can still file food ideas without [the
// grant] set": no owner gate here, any member in the community may file
// against the plan on the page (the community's active plan for the
// scope). Persists until the kitchen holder decides it; the inbox is
// the holder's surface.
export async function fileFoodIdea(actor: Member, input: FileFoodIdeaInput) {
  await requireKitchenModuleOn(actor);
  await getMenuPlan(actor, input.menuPlanId); // community check + 404

  const [created] = await db
    .insert(foodIdea)
    .values({
      menuPlanId: input.menuPlanId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      suggestedBy: actor.id,
    })
    .returning();
  return created;
}

// The holder's inbox — open ideas on a plan they can still act on
// (draft + owned). Published plans lock adoption, so their ideas don't
// queue up as actionable here; the owner starts a new draft for them.
export async function listOpenIdeasForReview(actor: Member, menuPlanId: string) {
  await requireEditableMenuPlan(actor, menuPlanId);
  return db.select().from(foodIdea).where(eq(foodIdea.menuPlanId, menuPlanId)).orderBy(desc(foodIdea.createdAt));
}

export async function listIdeasForMenuPlan(actor: Member, menuPlanId: string) {
  // Read posture: the plan must be visible, then its ideas list (all
  // statuses — the owner's "what did we do with what people suggested"
  // view on a draft they can still act on).
  await getVisibleMenuPlan(actor, menuPlanId);
  return db.select().from(foodIdea).where(eq(foodIdea.menuPlanId, menuPlanId)).orderBy(desc(foodIdea.createdAt));
}

async function getIdeaInCommunity(actor: Member, ideaId: string) {
  const [row] = await db.select().from(foodIdea).where(eq(foodIdea.id, ideaId));
  void actor;
  if (!row) throw new NotFoundError("Food idea not found");
  return row;
}

export async function declineFoodIdea(actor: Member, ideaId: string, input: DeclineFoodIdeaInput) {
  await requireKitchenModuleOn(actor);
  const idea = await getIdeaInCommunity(actor, ideaId);
  if (idea.status !== "open") {
    throw new ConflictError("This idea has already been decided");
  }
  await requireEditableMenuPlan(actor, idea.menuPlanId);

  const [updated] = await db
    .update(foodIdea)
    .set({ status: "declined", declinedReason: input.declinedReason ?? null })
    .where(eq(foodIdea.id, ideaId))
    .returning();
  return updated;
}