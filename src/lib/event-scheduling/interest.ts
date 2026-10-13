import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventProposal, eventProposalInterest, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { cycleScopeCondition, getEventProposal } from "./crud";
import { isEventSchedulingOwner } from "./conflicts";

type Member = typeof memberTable.$inferSelect;
type EventProposalRow = typeof eventProposal.$inferSelect;

/**
 * Members saying "I'd come to this" about proposals that are still open.
 *
 * It's a signal for whoever is planning the programme, not a vote: nothing
 * here approves, ranks or blocks a proposal, and the owner still decides.
 * Two levels, "yes" and "maybe", because those are the answers a planner can
 * use; no row at all means no response, so there is no "no" to record.
 *
 * Counts are open to every member. *Who* is behind them is not: only the
 * proposal's own submitter and the scheduling owner for its event get the
 * names, which is enough to follow up with people and keeps a popular
 * proposal from turning into a popularity contest. That rule lives here and
 * not in the page, so no caller can show names by forgetting to check.
 */
export const interestLevelInput = z.enum(["yes", "maybe"]);
export type InterestLevel = z.infer<typeof interestLevelInput>;

// A proposal is open to interest until the owner publishes or declines it:
// that is the stretch where the answer can still change what gets planned.
function isOpen(p: EventProposalRow) {
  return !p.publishedAt && p.status !== "declined";
}

/**
 * Sets, changes or (with null) withdraws the actor's interest. Any member
 * can respond to any open proposal except their own — a host's own
 * proposal already says they want it, and counting them would inflate it.
 */
export async function setEventProposalInterest(
  actor: Member,
  proposalId: string,
  level: InterestLevel | null,
) {
  requireModuleEnabled(await getCommunity(actor), "event_scheduling");
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.submittedBy === actor.id) {
    throw new AppError("That's your own proposal");
  }
  if (!isOpen(proposal)) {
    throw new AppError("This proposal is no longer open to interest");
  }

  if (level === null) {
    await db
      .delete(eventProposalInterest)
      .where(
        and(eq(eventProposalInterest.proposalId, proposalId), eq(eventProposalInterest.memberId, actor.id)),
      );
    return null;
  }

  interestLevelInput.parse(level);
  const [row] = await db
    .insert(eventProposalInterest)
    .values({ proposalId, memberId: actor.id, level })
    .onConflictDoUpdate({
      target: [eventProposalInterest.proposalId, eventProposalInterest.memberId],
      set: { level, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export interface ProposalInterest {
  yes: number;
  maybe: number;
  /** The actor's own response, so the page can show which button is on. */
  mine: InterestLevel | null;
  /** Who's behind the counts — null unless the actor may see names. */
  people: { memberId: string; name: string; level: InterestLevel }[] | null;
}

/**
 * Interest for a set of proposals in one pass. Names come back only for a
 * proposal the actor submitted or whose event they are the scheduling owner
 * of; for everyone else `people` is null and only the counts are real.
 */
export async function getProposalInterest(
  actor: Member,
  proposals: EventProposalRow[],
): Promise<Map<string, ProposalInterest>> {
  const result = new Map<string, ProposalInterest>();
  if (proposals.length === 0) return result;

  const rows = await db
    .select({
      proposalId: eventProposalInterest.proposalId,
      memberId: eventProposalInterest.memberId,
      level: eventProposalInterest.level,
      name: member.name,
      createdAt: eventProposalInterest.createdAt,
    })
    .from(eventProposalInterest)
    .innerJoin(member, eq(member.id, eventProposalInterest.memberId))
    .where(
      inArray(
        eventProposalInterest.proposalId,
        proposals.map((p) => p.id),
      ),
    )
    .orderBy(eventProposalInterest.createdAt);

  // Ownership is per event, so ask once per distinct cycle rather than once
  // per proposal.
  const ownerByCycle = new Map<string | null, boolean>();
  for (const p of proposals) {
    if (!ownerByCycle.has(p.cycleId)) {
      ownerByCycle.set(p.cycleId, await isEventSchedulingOwner(actor, p.cycleId));
    }
  }

  for (const p of proposals) {
    const mine = rows.filter((r) => r.proposalId === p.id);
    const maySeeNames = p.submittedBy === actor.id || ownerByCycle.get(p.cycleId) === true;
    result.set(p.id, {
      yes: mine.filter((r) => r.level === "yes").length,
      maybe: mine.filter((r) => r.level === "maybe").length,
      mine: mine.find((r) => r.memberId === actor.id)?.level ?? null,
      people: maySeeNames
        ? mine.map((r) => ({ memberId: r.memberId, name: r.name, level: r.level }))
        : null,
    });
  }
  return result;
}

/**
 * Other members' proposals that are still open — what a member browses to
 * say what they'd come to. Their own are left out (they're in "your
 * proposals"), as are declined and published ones.
 */
export async function listOpenEventProposalsForInterest(actor: Member, cycleId?: string | null) {
  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    ne(eventProposal.submittedBy, actor.id),
    isNull(eventProposal.publishedAt),
    ne(eventProposal.status, "declined"),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(eventProposal)
    .where(and(...conditions))
    .orderBy(desc(eventProposal.createdAt));
}
