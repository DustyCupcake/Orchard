import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import type { DbOrTx } from "@/db";
import {
  admission,
  communityCheck,
  communityCheckConcern,
  communityInvite,
  formResponse,
  recruitmentApplicationInvite,
} from "@/db/schema";
import type { CommunityCheckEndedAs, CommunityCheckKind, CommunityCheckOnQuiet, member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, listHeldRecruitmentScopes, requireRecruitmentScopeForCycle, requireRecruitmentTaskHolder } from "./access";

// docs/admission-flow.md §5 — the community check, one mechanism.
//
// This file is the window itself: opening it, reading it, raising a concern in
// it. What happens when it *ends* — the arrival admitted, declined, sent back for
// more — is the funnel's, in check-outcome.ts, so the two halves of the old
// design that disagreed about it (a window that applied its own default, a
// mediation outcome applied by calling back into holder-only functions) cannot
// come back.

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;
type Check = typeof communityCheck.$inferSelect;

const MS_PER_HOUR = 3_600_000;

const isTerminal = (a: Pick<Arrival, "admittedMemberId" | "declinedAt" | "withdrawnAt">) =>
  Boolean(a.admittedMemberId || a.declinedAt || a.withdrawnAt);
export { isTerminal as arrivalIsFinished };

export async function getOpenCheck(arrivalId: string, executor: DbOrTx = db): Promise<Check | null> {
  const [row] = await executor
    .select()
    .from(communityCheck)
    .where(and(eq(communityCheck.arrivalId, arrivalId), isNull(communityCheck.endedAt)));
  return row ?? null;
}

/** Every window an arrival has had, newest first — the history the record keeps. */
export async function listChecksFor(arrivalId: string): Promise<Check[]> {
  return db.select().from(communityCheck).where(eq(communityCheck.arrivalId, arrivalId)).orderBy(desc(communityCheck.openedAt));
}

/**
 * Open a window on an arrival. Idempotent: an arrival that already has one
 * open keeps it (there is at most one at a time), so the several places that can
 * ask for one — consent given at the door, a decision that leads to a wider
 * discussion — can't open two. The length is the community's setting as it is now,
 * stored with the deadline so what the person was told stays readable.
 */
export async function openCheck(
  arrival: Pick<Arrival, "id" | "communityId">,
  kind: CommunityCheckKind,
  onQuiet: CommunityCheckOnQuiet,
  opts: { deadline?: Date } = {},
): Promise<Check> {
  const existing = await getOpenCheck(arrival.id);
  if (existing) return existing;
  const communityRow = await getCommunityRow(arrival.communityId);
  const hours = communityRow.recruitmentWiderDiscussionHours;
  const [created] = await db
    .insert(communityCheck)
    .values({
      communityId: arrival.communityId,
      arrivalId: arrival.id,
      kind,
      onQuiet,
      windowHours: hours,
      deadline: opts.deadline ?? new Date(Date.now() + hours * MS_PER_HOUR),
    })
    .onConflictDoNothing()
    .returning();
  // Lost a race with another opener: theirs is the window.
  return created ?? (await getOpenCheck(arrival.id))!;
}

/** End whatever window an arrival has open, because the arrival itself has ended. Idempotent. */
export async function closeOpenCheck(arrivalId: string, executor: DbOrTx = db): Promise<void> {
  await executor
    .update(communityCheck)
    .set({ endedAt: new Date(), endedAs: "closed" satisfies CommunityCheckEndedAs })
    .where(and(eq(communityCheck.arrivalId, arrivalId), isNull(communityCheck.endedAt)));
}

/** Concerns still standing on this arrival, across every window it has had. */
export async function standingConcernCount(arrivalId: string, executor: DbOrTx = db): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .where(and(eq(communityCheck.arrivalId, arrivalId), eq(communityCheckConcern.resolution, "standing")));
  return row?.count ?? 0;
}

export async function hasStandingConcern(arrivalId: string, executor: DbOrTx = db): Promise<boolean> {
  return (await standingConcernCount(arrivalId, executor)) > 0;
}

/**
 * Who stood behind this arrival, if anyone: the member who sent the invite, or the
 * one whose invite the application was made with. They are the one person who may
 * not raise a concern about it (§5 — the shield does not leak through the person's
 * friend, and the cheapest way to keep that promise is not to let the friend raise
 * one at all).
 */
export async function inviterOf(arrival: Pick<Arrival, "inviteId" | "formResponseId">): Promise<string | null> {
  if (arrival.inviteId) {
    const [invite] = await db.select({ createdBy: communityInvite.createdBy }).from(communityInvite).where(eq(communityInvite.id, arrival.inviteId));
    if (invite) return invite.createdBy;
  }
  if (arrival.formResponseId) {
    const [linked] = await db
      .select({ createdBy: communityInvite.createdBy })
      .from(recruitmentApplicationInvite)
      .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
      .where(eq(recruitmentApplicationInvite.formResponseId, arrival.formResponseId));
    if (linked) return linked.createdBy;
  }
  return null;
}

export const raiseConcernInput = z.object({
  note: z.string().trim().min(1, "Say what your concern is"),
});
export type RaiseConcernInput = z.infer<typeof raiseConcernInput>;

/**
 * Raise a concern about an arrival whose window is open — the one way to do it,
 * for every arrival, whichever way its window opened. Any member of the community
 * can, except the person who stood behind the arrival; and a member says it once
 * (a second thing to add is a conversation with the mediation body, not a second
 * concern).
 *
 * A concern raised holds the arrival. It is never dropped by the clock, and
 * nobody is admitted over it.
 */
export async function raiseConcern(actor: Member, arrivalId: string, input: RaiseConcernInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");
  const { note } = raiseConcernInput.parse(input);

  const [arrival] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  if (!arrival || arrival.communityId !== actor.communityId) {
    throw new NotFoundError("That arrival isn't in your community");
  }
  const check = isTerminal(arrival) ? null : await getOpenCheck(arrival.id);
  if (!check) {
    throw new ConflictError("This arrival isn't open for a community check right now");
  }
  if (check.deadline < new Date()) {
    throw new ConflictError("The window for raising a concern about this arrival has closed");
  }
  if ((await inviterOf(arrival)) === actor.id) {
    throw new ForbiddenError("You invited this person, so you can't raise a concern about their arrival");
  }

  const [already] = await db
    .select({ id: communityCheckConcern.id })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .where(and(eq(communityCheck.arrivalId, arrival.id), eq(communityCheckConcern.raisedById, actor.id)));
  if (already) {
    throw new ConflictError("You've already raised a concern about this arrival");
  }

  const [created] = await db
    .insert(communityCheckConcern)
    .values({ communityId: actor.communityId, checkId: check.id, raisedById: actor.id, note })
    .returning();
  return created;
}

export type OpenCheckForMember = {
  arrivalId: string;
  name: string;
  kind: CommunityCheckKind;
  deadline: Date;
  openedAt: Date;
  route: Arrival["route"];
  cycleId: string | null;
  /** Whether this member may raise a concern now, and if not, why — so the page can say instead of hiding. */
  mayRaise: { ok: true } | { ok: false; reason: string };
  /** A concern this member raised that is still standing, so they can withdraw it. Theirs alone to see. */
  myStandingConcernId: string | null;
};

/**
 * The windows open right now, for a member to read and, if they have something to
 * say, raise a concern in. Names the person and how they arrived and nothing
 * about their application: what the people who read it saw is the evaluators' to
 * weigh, and a member raising a concern is raising it about the arrival.
 */
export async function listOpenChecksForMember(actor: Member): Promise<OpenCheckForMember[]> {
  const rows = await db
    .select({ check: communityCheck, arrival: admission })
    .from(communityCheck)
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(
      and(
        eq(communityCheck.communityId, actor.communityId),
        isNull(communityCheck.endedAt),
        isNull(admission.admittedMemberId),
        isNull(admission.declinedAt),
        isNull(admission.withdrawnAt),
      ),
    )
    .orderBy(communityCheck.deadline);
  if (rows.length === 0) return [];

  const mine = await db
    .select({ arrivalId: communityCheck.arrivalId, concernId: communityCheckConcern.id, resolution: communityCheckConcern.resolution })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .where(
      and(
        eq(communityCheckConcern.raisedById, actor.id),
        inArray(
          communityCheck.arrivalId,
          rows.map((r) => r.arrival.id),
        ),
      ),
    );
  const raised = new Set(mine.map((m) => m.arrivalId));
  const standingOf = new Map(mine.filter((m) => m.resolution === "standing").map((m) => [m.arrivalId, m.concernId]));

  const out: OpenCheckForMember[] = [];
  for (const { check, arrival } of rows) {
    let mayRaise: OpenCheckForMember["mayRaise"] = { ok: true };
    if (check.deadline < new Date()) mayRaise = { ok: false, reason: "The window has closed." };
    else if (raised.has(arrival.id)) mayRaise = { ok: false, reason: "You've raised a concern about this arrival." };
    else if ((await inviterOf(arrival)) === actor.id) mayRaise = { ok: false, reason: "You invited this person." };
    out.push({
      arrivalId: arrival.id,
      name: arrival.name,
      kind: check.kind,
      deadline: check.deadline,
      openedAt: check.openedAt,
      route: arrival.route,
      cycleId: arrival.cycleId,
      mayRaise,
      myStandingConcernId: standingOf.get(arrival.id) ?? null,
    });
  }
  return out;
}

/**
 * What the people who evaluate an application are told about the concerns on it: a
 * note and a date, and how it ended. Never who raised it — `raisedById` is the
 * shield, and the one reader of it is the mediation body (canSeeObjectorIdentity).
 * Scoped like every other holder read: a cycle-placed holder sees their own
 * cycle's applications.
 */
export async function listConcerns(actor: Member, formResponseId: string) {
  await requireRecruitmentTaskHolder(actor);
  const [response] = await db.select({ cycleId: formResponse.cycleId }).from(formResponse).where(eq(formResponse.id, formResponseId));
  if (!response) throw new NotFoundError("Application not found");
  await requireRecruitmentScopeForCycle(actor, response.cycleId);
  const [arrival] = await db.select().from(admission).where(eq(admission.formResponseId, formResponseId));
  if (!arrival) return [];
  return concernsOf(arrival.id);
}

/** The same for an arrival that has no application (a lane that asks only for a conversation). */
export async function listConcernsForArrival(actor: Member, arrivalId: string) {
  await requireRecruitmentTaskHolder(actor);
  const [arrival] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  if (!arrival || arrival.communityId !== actor.communityId) throw new NotFoundError("Arrival not found");
  await requireRecruitmentScopeForCycle(actor, arrival.cycleId);
  return concernsOf(arrival.id);
}

function concernsOf(arrivalId: string) {
  return db
    .select({
      id: communityCheckConcern.id,
      note: communityCheckConcern.note,
      raisedAt: communityCheckConcern.raisedAt,
      resolution: communityCheckConcern.resolution,
      resolvedAt: communityCheckConcern.resolvedAt,
      resolutionNote: communityCheckConcern.resolutionNote,
    })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .where(eq(communityCheck.arrivalId, arrivalId))
    .orderBy(communityCheckConcern.raisedAt);
}

/**
 * The recruitment team's own view of standing concerns: told one exists and has to
 * go and talk to somebody, and nothing else — no note, no date of who, no name.
 * The team is the audience the mediation conversation ("talking with the objector,
 * the inviter/applicant, and the invitee separately") is written for, and the
 * separation only works if they start without the note in front of them.
 */
export async function listStandingConcernSummaries(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const held = await listHeldRecruitmentScopes(actor);
  const rows = await db
    .select({
      id: communityCheckConcern.id,
      arrivalId: admission.id,
      cycleId: admission.cycleId,
      raisedAt: communityCheckConcern.raisedAt,
      resolution: communityCheckConcern.resolution,
    })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(and(eq(communityCheckConcern.communityId, actor.communityId), eq(communityCheckConcern.resolution, "standing")));
  return rows.filter((r) => held.has(null) || (r.cycleId !== null && held.has(r.cycleId)));
}

export type WiderDiscussionWindow = {
  status: "open" | "closed";
  deadline: Date;
  endedAs: CommunityCheckEndedAs | null;
};

/**
 * The window a wider discussion opened for this application, if its reports led to
 * one — for the evaluators' list, which shows whether it is still running. `open`
 * means a member can still raise a concern; `closed` is past its deadline or ended,
 * which is not the same as decided (a standing concern holds it past the clock).
 */
export async function getWiderDiscussionWindow(formResponseId: string): Promise<WiderDiscussionWindow | null> {
  const [row] = await db
    .select({ check: communityCheck })
    .from(communityCheck)
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(and(eq(admission.formResponseId, formResponseId), eq(communityCheck.kind, "evaluation")))
    .orderBy(desc(communityCheck.openedAt))
    .limit(1);
  if (!row) return null;
  const { check } = row;
  return {
    status: !check.endedAt && check.deadline > new Date() ? "open" : "closed",
    deadline: check.deadline,
    endedAs: check.endedAs,
  };
}

/** Windows whose clock has run out, for the job. Not filtered by concerns: reconciling decides. */
export async function listOpenChecks(executor: DbOrTx = db): Promise<Check[]> {
  return executor.select().from(communityCheck).where(isNull(communityCheck.endedAt));
}

export async function listOpenChecksPastDeadline(executor: DbOrTx = db): Promise<Check[]> {
  return executor
    .select()
    .from(communityCheck)
    .where(and(isNull(communityCheck.endedAt), lt(communityCheck.deadline, new Date())));
}
