import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, community, schedulingPoll, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { createTask } from "../tasks/crud";

type Member = typeof memberTable.$inferSelect;

export const createPollInput = z.object({
  branchId: z.string().uuid(),
  title: z.string().min(1),
  resolutionMode: z.enum(["must_overlap", "max_attendance"]),
  requiredParticipantIds: z.array(z.string().uuid()).optional(),
  minAttendance: z.number().int().positive().optional(),
  rangeStart: z.string().min(1),
  rangeEnd: z.string().min(1),
  hasAgenda: z.boolean().optional(),
  needsSummary: z.boolean().optional(),
  requireRead: z.boolean().optional(),
});
export type CreatePollInput = z.infer<typeof createPollInput>;

// Pre-fills hasAgenda/needsSummary/requireRead from the Branch's own
// default, falling back to the Community's — see docs/spec.md's
// "Defaults live per Branch, with a Community-level fallback". The
// caller can still override any of the three for this one instance.
async function resolveCallDefaults(branchId: string, communityId: string) {
  const [branchRow] = await db.select().from(branch).where(eq(branch.id, branchId));
  const [communityRow] = await db.select().from(community).where(eq(community.id, communityId));
  return {
    hasAgenda: branchRow?.defaultCallHasAgenda ?? communityRow?.defaultCallHasAgenda ?? false,
    needsSummary: branchRow?.defaultCallNeedsSummary ?? communityRow?.defaultCallNeedsSummary ?? false,
    requireRead: branchRow?.defaultCallRequireRead ?? communityRow?.defaultCallRequireRead ?? false,
  };
}

// "Scheduling a poll spins up two tasks right away" — see
// docs/spec.md's "Facilitation and summary are auto-created tasks,
// not a manual step." Titles reference the poll's own title rather
// than "[date]'s call" since no date is known yet at scheduling time
// (that's the whole point of the poll) — confirmSlot() in resolve.ts
// updates both titles to the real date once one is confirmed.
async function createSourceTasks(actor: Member, poll: typeof schedulingPoll.$inferSelect) {
  const facilitate = await createTask(actor, {
    branchId: poll.branchId,
    title: `Facilitate "${poll.title}"`,
    effort: "one_off",
    effortMagnitude: { duration: "under_hour" },
  });
  await db
    .update(task)
    .set({ sourcePollId: poll.id, sourcePollRole: "facilitate" })
    .where(eq(task.id, facilitate.id));

  const summary = await createTask(actor, {
    branchId: poll.branchId,
    title: `Take notes & publish the summary for "${poll.title}"`,
    effort: "one_off",
    effortMagnitude: { duration: "under_hour" },
  });
  await db
    .update(task)
    .set({ sourcePollId: poll.id, sourcePollRole: "summary" })
    .where(eq(task.id, summary.id));
}

export async function createPoll(actor: Member, input: CreatePollInput) {
  const [branchRow] = await db
    .select()
    .from(branch)
    .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
  if (!branchRow) {
    throw new NotFoundError("Branch not found in your community");
  }

  const defaults = await resolveCallDefaults(input.branchId, actor.communityId);

  const [created] = await db
    .insert(schedulingPoll)
    .values({
      communityId: actor.communityId,
      branchId: input.branchId,
      title: input.title,
      organizedBy: actor.id,
      resolutionMode: input.resolutionMode,
      requiredParticipantIds: input.requiredParticipantIds ?? [],
      minAttendance: input.minAttendance ?? null,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      hasAgenda: input.hasAgenda ?? defaults.hasAgenda,
      needsSummary: input.needsSummary ?? defaults.needsSummary,
      requireRead: input.requireRead ?? defaults.requireRead,
    })
    .returning();

  await createSourceTasks(actor, created);

  return created;
}

export async function listPolls(actor: Member) {
  return db
    .select()
    .from(schedulingPoll)
    .where(eq(schedulingPoll.communityId, actor.communityId))
    .orderBy(desc(schedulingPoll.createdAt));
}

export async function requirePollInCommunity(actor: Member, pollId: string) {
  const [row] = await db
    .select()
    .from(schedulingPoll)
    .where(and(eq(schedulingPoll.id, pollId), eq(schedulingPoll.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Scheduling poll not found");
  }
  return row;
}

export async function getPoll(actor: Member, pollId: string) {
  return requirePollInCommunity(actor, pollId);
}
