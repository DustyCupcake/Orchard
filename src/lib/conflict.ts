import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, conflictReport, conflictReportExclusion, member, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

// "The conflict team" isn't a dedicated relationship — it's whoever
// currently holds (really holds — a shadow doesn't count, same as
// everywhere else) Community.conflictTeamTaskId. See
// docs/spec.md's "The conflict team is just a task, reusing what
// already exists."
export async function isConflictTeamMemberId(communityId: string, memberId: string) {
  const [communityRow] = await db.select().from(community).where(eq(community.id, communityId));
  if (!communityRow?.conflictTeamTaskId) return false;

  const [holding] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.taskId, communityRow.conflictTeamTaskId),
        eq(taskAssignment.memberId, memberId),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, communityId),
      ),
    );
  return Boolean(holding);
}

export async function isConflictTeamMember(actor: Member) {
  return isConflictTeamMemberId(actor.communityId, actor.id);
}

export async function requireConflictTeamMember(actor: Member) {
  if (!(await isConflictTeamMember(actor))) {
    throw new ForbiddenError("Only a current conflict-team member can do this");
  }
}

// For the reporter's exclude-at-creation picker and the peer-recuse
// picker — who's currently eligible to be excluded from a report at
// all.
export async function listConflictTeamMemberIds(communityId: string) {
  const [communityRow] = await db.select().from(community).where(eq(community.id, communityId));
  if (!communityRow?.conflictTeamTaskId) return [];

  const rows = await db
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.taskId, communityRow.conflictTeamTaskId),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, communityId),
      ),
    );
  return rows.map((r) => r.memberId);
}

// Reporting starts as a low-friction signal, not a form — see
// docs/spec.md's "Reporting starts as a low-friction signal, not a
// form." excludeMemberIds covers the reporter-excludes-at-creation
// route; self- and peer-recusal (below) are the other two.
export const fileConflictReportInput = z.object({
  description: z.string().min(1).nullable().optional(),
  excludeMemberIds: z.array(z.string().uuid()).optional(),
});
export type FileConflictReportInput = z.infer<typeof fileConflictReportInput>;

export async function fileConflictReport(actor: Member, input: FileConflictReportInput) {
  const [communityRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!communityRow?.conflictTeamTaskId) {
    throw new AppError("Conflict management isn't set up for this Community yet");
  }

  const [created] = await db
    .insert(conflictReport)
    .values({
      communityId: actor.communityId,
      reportedBy: actor.id,
      description: input.description ?? null,
    })
    .returning();

  for (const memberId of input.excludeMemberIds ?? []) {
    const [memberRow] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
    if (!memberRow) {
      throw new NotFoundError("Member not found in your community");
    }
    await db
      .insert(conflictReportExclusion)
      .values({ reportId: created.id, memberId, addedBy: actor.id });
  }

  return created;
}

// The invisibility guarantee, done via the query itself — a real
// LEFT JOIN anti-join against this actor's own exclusion rows, never a
// post-fetch filter or a redacted placeholder. An excluded team
// member's queue looks exactly as if the excluded reports don't exist.
//
// Visibility, beyond exclusion: the reporter always sees their own
// report. A current, non-excluded team member additionally sees it
// while it's unacknowledged (so anyone eligible can pick it up),
// while they're the one who acknowledged it (point of contact), or
// once it's escalated (widens back to the whole non-excluded team) —
// see docs/development-plan.md's Phase 21 for why acknowledging
// narrows visibility down from the team to just the point of contact
// rather than leaving it team-wide throughout.
export async function listConflictReports(actor: Member, opts: { reportId?: string } = {}) {
  const isTeamMember = await isConflictTeamMember(actor);

  const visibility = isTeamMember
    ? or(
        eq(conflictReport.reportedBy, actor.id),
        isNull(conflictReport.acknowledgedAt),
        eq(conflictReport.escalated, true),
        eq(conflictReport.acknowledgedBy, actor.id),
      )
    : eq(conflictReport.reportedBy, actor.id);

  const conditions = [
    eq(conflictReport.communityId, actor.communityId),
    // The anti-join: a matching exclusion row for this specific actor
    // means "no exclusion for me" is false, so isNull(exclusion.id)
    // over the joined row is what actually enforces invisibility —
    // done by the query itself, never a post-fetch filter.
    isNull(conflictReportExclusion.id),
    visibility,
  ];
  if (opts.reportId) {
    conditions.push(eq(conflictReport.id, opts.reportId));
  }

  const rows = await db
    .select({ report: conflictReport })
    .from(conflictReport)
    .leftJoin(
      conflictReportExclusion,
      and(
        eq(conflictReportExclusion.reportId, conflictReport.id),
        eq(conflictReportExclusion.memberId, actor.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(conflictReport.createdAt));

  return rows.map((r) => r.report);
}

export interface ConflictNeedsAction {
  reportId: string;
  createdAt: Date;
}

// Dashboard's own needs-action surface — see docs/development-plan.md's
// Phase 49. Reuses listConflictReports exactly as it already exists —
// never a second, unfiltered path — so an excluded team member simply
// never sees an item here for a report they can't see at all, the same
// invisibility guarantee everything else in this module already holds.
// "Past the acknowledgment window" per Community.conflictAckWindowHours
// (already read elsewhere for the same purpose, just never surfaced as
// a Dashboard nudge until now).
export async function listConflictNeedsAction(actor: Member): Promise<ConflictNeedsAction[]> {
  if (!(await isConflictTeamMember(actor))) return [];

  const [communityRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  const cutoff = new Date(Date.now() - (communityRow?.conflictAckWindowHours ?? 24) * 3600_000);

  const reports = await listConflictReports(actor);
  return reports
    .filter((r) => !r.acknowledgedAt && r.createdAt < cutoff)
    .map((r) => ({ reportId: r.id, createdAt: r.createdAt }));
}

export async function getConflictReport(actor: Member, reportId: string) {
  const [report] = await listConflictReports(actor, { reportId });
  if (!report) {
    throw new NotFoundError("Conflict report not found");
  }
  return report;
}

// Visible to whoever can already see the report — that's the point:
// once you can see a report at all, seeing who's excluded from it (and
// who added them) is what lets the rest of the team coordinate around
// the gap.
export async function listConflictReportExclusions(actor: Member, reportId: string) {
  await getConflictReport(actor, reportId);
  return db
    .select()
    .from(conflictReportExclusion)
    .where(eq(conflictReportExclusion.reportId, reportId))
    .orderBy(conflictReportExclusion.addedAt);
}

async function addExclusionIfMissing(reportId: string, memberId: string, addedBy: string) {
  const [existing] = await db
    .select({ id: conflictReportExclusion.id })
    .from(conflictReportExclusion)
    .where(and(eq(conflictReportExclusion.reportId, reportId), eq(conflictReportExclusion.memberId, memberId)));
  if (existing) return existing;

  const [created] = await db
    .insert(conflictReportExclusion)
    .values({ reportId, memberId, addedBy })
    .returning();
  return created;
}

// A team member recusing themselves on realizing a conflict of
// interest the reporter had no way to flag — see docs/spec.md's
// "Recusal, from three directions, not just the reporter." Requires
// the actor to currently have visibility (i.e. not already excluded)
// — the one honest limit spec names: this can't un-show what they've
// already read, only stop further handling.
export async function recuseSelf(actor: Member, reportId: string) {
  await requireConflictTeamMember(actor);
  await getConflictReport(actor, reportId);
  return addExclusionIfMissing(reportId, actor.id, actor.id);
}

// One team member recusing another, for the same reason (e.g. a
// partner) — the person carrying the bias doesn't always recognize or
// volunteer it themselves.
export async function recusePeer(actor: Member, reportId: string, targetMemberId: string) {
  await requireConflictTeamMember(actor);
  await getConflictReport(actor, reportId);
  if (!(await isConflictTeamMemberId(actor.communityId, targetMemberId))) {
    throw new NotFoundError("Not a current conflict-team member");
  }
  return addExclusionIfMissing(reportId, targetMemberId, actor.id);
}

// Whichever eligible team member takes it becomes the point of
// contact — see docs/spec.md's Flow.
export async function acknowledgeConflictReport(actor: Member, reportId: string) {
  await requireConflictTeamMember(actor);
  const report = await getConflictReport(actor, reportId);
  if (report.acknowledgedAt) {
    throw new ConflictError("Already acknowledged");
  }

  const [updated] = await db
    .update(conflictReport)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: actor.id })
    .where(eq(conflictReport.id, reportId))
    .returning();
  return updated;
}

export const resolveConflictReportInput = z.object({ resolutionNote: z.string().min(1) });
export type ResolveConflictReportInput = z.infer<typeof resolveConflictReportInput>;

export async function resolveConflictReport(
  actor: Member,
  reportId: string,
  input: ResolveConflictReportInput,
) {
  const report = await getConflictReport(actor, reportId);
  if (!report.acknowledgedAt) {
    throw new ConflictError("Must be acknowledged before it can be resolved");
  }
  if (report.acknowledgedBy !== actor.id) {
    throw new ForbiddenError("Only the point of contact can record a resolution");
  }
  if (report.resolvedAt) {
    throw new ConflictError("Already resolved");
  }

  const [updated] = await db
    .update(conflictReport)
    .set({ resolvedAt: new Date(), resolutionNote: input.resolutionNote })
    .where(eq(conflictReport.id, reportId))
    .returning();
  return updated;
}

// Only the reporter escalates, per spec: "Visible only to the reporter
// and whoever's handling it, unless the reporter chooses to escalate
// further" — widening to the whole non-excluded team is the
// reporter's own call, not the handler's.
export async function escalateConflictReport(actor: Member, reportId: string) {
  const report = await getConflictReport(actor, reportId);
  if (report.reportedBy !== actor.id) {
    throw new ForbiddenError("Only the reporter can escalate their own report");
  }
  if (report.escalated) {
    throw new ConflictError("Already escalated");
  }

  const [updated] = await db
    .update(conflictReport)
    .set({ escalated: true })
    .where(eq(conflictReport.id, reportId))
    .returning();
  return updated;
}
