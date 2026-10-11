import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { admissionLane, community, cycle, cycleAdmissionLane, type member as memberTable } from "@/db/schema";
import type { AdmissionVerification } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { requireAdmins } from "../settings/admins";
import { validateDecisionPolicy } from "./decision-policy";
import { policyOf } from "./evaluations";
import { requireCycleInitiationEligibility } from "../cycles/crud";
import { requireCycleOpen } from "../cycles/lifecycle";
import {
  laneHandles,
  normalizeLaneRule,
  startingLanes,
  validateLanes,
  type AdmissionLaneRule,
  type InviterDeclaration,
} from "./lane-rules";

// The database half of docs/admission-flow.md §2a. Lanes are rows, they are
// community-wide, and what an event decides is only *which are open there*
// (`cycle.own_admission_lanes` + `cycle_admission_lane`). Nothing else about a
// lane varies by event, so there is exactly one place a lane's rule lives and
// no override chain to resolve. The pure half — the rule's shape, its route,
// its sentence, the validation — is lane-rules.ts, which a client component
// can import.

export type AdmissionLane = typeof admissionLane.$inferSelect;
type Member = typeof memberTable.$inferSelect;

// Re-exported so server code has one import for lane vocabulary.
export { declarationFromMarks as declarationFromInvite } from "./lane-rules";
export type { InviterDeclaration, AdmissionLaneRule } from "./lane-rules";

export function laneRuleOf(row: AdmissionLane): AdmissionLaneRule {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    handlesKnowsPersonally: row.handlesKnowsPersonally,
    handlesGoodFitOnly: row.handlesGoodFitOnly,
    handlesNeither: row.handlesNeither,
    publicSlug: row.publicSlug,
    applicationRequired: row.applicationRequired,
    interviewRequired: row.interviewRequired,
    verification: row.verification,
    reportsNeeded: row.reportsNeeded,
    supportShortcutCount: row.supportShortcutCount,
    openInCommunity: row.openInCommunity,
  };
}

/**
 * Give a community its starting lanes if it has never had any (§2a: *Invited*
 * and *Open application*). Communities that existed when lanes became rows were
 * carried over by migration; this is for the ones created afterwards, and for
 * a test fixture, none of which has a migration to seed them. Every read goes
 * through here, so there is never a "no lanes yet" state for a caller to
 * invent a stand-in for. A community that has lanes — even only archived ones
 * — is left alone, and a race between two first readers is absorbed by the
 * unique name index.
 */
export async function ensureAdmissionLanes(communityId: string): Promise<void> {
  const [any] = await db
    .select({ id: admissionLane.id })
    .from(admissionLane)
    .where(eq(admissionLane.communityId, communityId))
    .limit(1);
  if (any) return;
  await db
    .insert(admissionLane)
    .values(startingLanes().map((rule) => ({ communityId, ...rowValues(rule) })))
    .onConflictDoNothing();
}

function rowValues(rule: AdmissionLaneRule) {
  return {
    name: rule.name,
    kind: rule.kind,
    handlesKnowsPersonally: rule.handlesKnowsPersonally,
    handlesGoodFitOnly: rule.handlesGoodFitOnly,
    handlesNeither: rule.handlesNeither,
    publicSlug: rule.publicSlug,
    applicationRequired: rule.applicationRequired,
    interviewRequired: rule.interviewRequired,
    verification: rule.verification as AdmissionVerification,
    reportsNeeded: rule.reportsNeeded,
    supportShortcutCount: rule.supportShortcutCount,
    openInCommunity: rule.openInCommunity,
  };
}

/** Every lane a community has, oldest first so the first public lane is stable. */
export async function listLanes(communityId: string, opts: { includeArchived?: boolean } = {}): Promise<AdmissionLane[]> {
  await ensureAdmissionLanes(communityId);
  return db
    .select()
    .from(admissionLane)
    .where(
      opts.includeArchived
        ? eq(admissionLane.communityId, communityId)
        : and(eq(admissionLane.communityId, communityId), isNull(admissionLane.archivedAt)),
    )
    .orderBy(asc(admissionLane.createdAt), asc(admissionLane.name));
}

/**
 * The lanes that are open in a context: the community's general door
 * (`cycleId` null), or one event. An event follows the community's set unless
 * it has chosen its own. Archived lanes are open nowhere.
 */
export async function listOpenLanes(communityId: string, cycleId: string | null): Promise<AdmissionLane[]> {
  const lanes = await listLanes(communityId);
  if (!cycleId) return lanes.filter((l) => l.openInCommunity);
  const [row] = await db
    .select({ own: cycle.ownAdmissionLanes })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) throw new NotFoundError("Event not found in your community");
  if (!row.own) return lanes.filter((l) => l.openInCommunity);
  const chosen = await db
    .select({ laneId: cycleAdmissionLane.laneId })
    .from(cycleAdmissionLane)
    .where(eq(cycleAdmissionLane.cycleId, cycleId));
  const ids = new Set(chosen.map((c) => c.laneId));
  return lanes.filter((l) => ids.has(l.id));
}

/** The lane that takes an invite carrying this declaration, in this context. */
export async function resolveInviteLane(
  communityId: string,
  cycleId: string | null,
  declaration: InviterDeclaration,
): Promise<AdmissionLane | null> {
  const open = await listOpenLanes(communityId, cycleId);
  return open.find((l) => laneHandles(laneRuleOf(l), declaration)) ?? null;
}

/** The public lanes open in this context, first (the one at /apply) first. */
export async function listPublicLanes(communityId: string, cycleId: string | null): Promise<AdmissionLane[]> {
  const open = await listOpenLanes(communityId, cycleId);
  return open
    .filter((l) => l.kind === "public")
    .sort((a, b) => Number(a.publicSlug !== null) - Number(b.publicSlug !== null));
}

/**
 * The public lane a link points at. No slug is the address /apply itself,
 * which is the lane without a slug if there is one, else the first public lane
 * open — so a community whose only public lane has an address still has a
 * working /apply.
 */
export async function resolvePublicLane(
  communityId: string,
  cycleId: string | null,
  slug?: string | null,
): Promise<AdmissionLane | null> {
  const lanes = await listPublicLanes(communityId, cycleId);
  if (slug) return lanes.find((l) => l.publicSlug === slug) ?? null;
  return lanes[0] ?? null;
}

/** The part of a lane an arrival keeps, copied onto it at entry (§1 principle
 *  2): editing a lane later changes the next arrival, never someone in flight. */
export type AdmissionLaneSnapshot = {
  requiredVerification: AdmissionVerification;
  requiredApplication: boolean;
  requiredInterview: boolean;
  requiredEvaluation: boolean;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
};

export function laneSnapshot(lane: AdmissionLane): AdmissionLaneSnapshot {
  return {
    requiredVerification: lane.verification,
    requiredApplication: lane.applicationRequired,
    requiredInterview: lane.interviewRequired,
    requiredEvaluation: lane.applicationRequired || lane.interviewRequired,
    reportsNeeded: lane.reportsNeeded,
    supportShortcutCount: lane.supportShortcutCount,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The live events that have chosen their own set of open lanes, with it. */
export async function listEventLaneSets(communityId: string) {
  const events = await openEventSets(communityId);
  return events.map((e) => ({ id: e.id, name: e.name, laneIds: [...e.laneIds] }));
}

async function openEventSets(communityId: string) {
  const events = await db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(and(eq(cycle.communityId, communityId), eq(cycle.ownAdmissionLanes, true), isNull(cycle.closedAt)));
  if (events.length === 0) return [];
  const rows = await db
    .select({ cycleId: cycleAdmissionLane.cycleId, laneId: cycleAdmissionLane.laneId })
    .from(cycleAdmissionLane)
    .where(inArray(cycleAdmissionLane.cycleId, events.map((e) => e.id)));
  return events.map((e) => ({
    id: e.id,
    name: e.name,
    label: `the event “${e.name}”`,
    laneIds: new Set(rows.filter((r) => r.cycleId === e.id).map((r) => r.laneId)),
  }));
}

/**
 * Save the community's lanes as a whole, as the settings panel submits them.
 * A lane in the list is created or updated; an existing lane missing from it
 * is archived, not deleted — people already in the funnel keep the path they
 * entered on, and an invite issued under it is held rather than revoked
 * (§2a). Nothing is written unless the whole set is valid (§3), and the
 * question "does every invite have somewhere to go" is asked of the community
 * and of each live event that has chosen its own lanes.
 */
export async function saveCommunityLanes(actor: Member, submitted: AdmissionLaneRule[]): Promise<AdmissionLane[]> {
  await requireAdmins(actor);
  const communityId = actor.communityId;
  const existing = await listLanes(communityId, { includeArchived: true });
  const byId = new Map(existing.map((l) => [l.id, l]));

  const rules = submitted.map(normalizeLaneRule);
  for (const rule of rules) {
    if (rule.id && !byId.has(rule.id)) throw new NotFoundError("That lane doesn't exist any more — reload and try again");
  }
  const kept = new Set(rules.map((r) => r.id).filter((id): id is string => Boolean(id)));
  const removed = existing.filter((l) => !l.archivedAt && !kept.has(l.id));

  // A lane can't be taken away from an event that is using it.
  const eventSets = await openEventSets(communityId);
  for (const lane of removed) {
    const using = eventSets.find((e) => e.laneIds.has(lane.id));
    if (using) {
      throw new AppError(`“${lane.name}” is open in ${using.label}. Choose a different set of lanes for that event first.`);
    }
  }

  // Names and addresses are unique across everything the community has ever
  // had, archived lanes included, because the indexes are.
  const archivedClaims = existing.filter((l) => l.archivedAt && !kept.has(l.id));
  for (const rule of rules) {
    const clash = archivedClaims.find((l) => l.name.toLowerCase() === rule.name.toLowerCase());
    if (clash) throw new AppError(`There is an archived lane called “${clash.name}” — choose a different name.`);
    const slugClash = rule.publicSlug && archivedClaims.find((l) => l.publicSlug === rule.publicSlug);
    if (slugClash) throw new AppError(`The address /apply/${rule.publicSlug} belongs to the archived lane “${slugClash.name}”.`);
  }

  const contexts = [
    { label: "the community", laneIndexes: rules.map((_, i) => i).filter((i) => rules[i].openInCommunity) },
    ...eventSets.map((e) => ({
      label: e.label,
      laneIndexes: rules.map((r, i) => (r.id && e.laneIds.has(r.id) ? i : -1)).filter((i) => i >= 0),
    })),
  ];
  const problems = validateLanes(rules, contexts);
  if (problems.length > 0) throw new AppError(problems[0]);

  // And lanes the community's decision policy could never decide: a custom
  // "at least 3 yes" on a lane that takes 2 reports waits for ever.
  const [communityRow] = await db.select().from(community).where(eq(community.id, communityId));
  const policyProblems = validateDecisionPolicy(
    policyOf(communityRow),
    rules.filter((r) => r.reportsNeeded !== null).map((r) => ({ name: r.name, reportsNeeded: r.reportsNeeded! })),
  );
  if (policyProblems.length > 0) throw new AppError(policyProblems[0]);

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const lane of removed) {
      await tx.update(admissionLane).set({ archivedAt: now, updatedAt: now }).where(eq(admissionLane.id, lane.id));
    }
    for (const rule of rules) {
      if (rule.id) {
        await tx
          .update(admissionLane)
          .set({ ...rowValues(rule), updatedAt: now })
          .where(and(eq(admissionLane.id, rule.id), eq(admissionLane.communityId, communityId)));
      } else {
        await tx.insert(admissionLane).values({ communityId, ...rowValues(rule) });
      }
    }
  });
  return listLanes(communityId);
}

/**
 * Choose which lanes an event opens: `null` follows the community's set,
 * otherwise exactly these lanes. The authority is the one that configures the
 * rest of an event (whoever may start one), and a closed event's lanes are
 * history, not configuration.
 */
export async function setEventLanes(actor: Member, cycleId: string, laneIds: string[] | null): Promise<void> {
  await requireCycleInitiationEligibility(actor);
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) throw new NotFoundError("Event not found");
  requireCycleOpen(row);

  if (laneIds === null) {
    await db.transaction(async (tx) => {
      await tx.delete(cycleAdmissionLane).where(eq(cycleAdmissionLane.cycleId, cycleId));
      await tx.update(cycle).set({ ownAdmissionLanes: false }).where(eq(cycle.id, cycleId));
    });
    return;
  }

  const lanes = await listLanes(actor.communityId);
  const wanted = new Set(laneIds);
  const chosen = lanes.filter((l) => wanted.has(l.id));
  if (chosen.length !== wanted.size) throw new NotFoundError("One of those lanes doesn't exist any more");
  const rules = chosen.map(laneRuleOf);
  const problems = validateLanes(rules, [{ label: "this event", laneIndexes: rules.map((_, i) => i) }]);
  if (problems.length > 0) throw new AppError(problems[0]);

  await db.transaction(async (tx) => {
    await tx.delete(cycleAdmissionLane).where(eq(cycleAdmissionLane.cycleId, cycleId));
    if (chosen.length > 0) {
      await tx.insert(cycleAdmissionLane).values(chosen.map((l) => ({ cycleId, laneId: l.id })));
    }
    await tx.update(cycle).set({ ownAdmissionLanes: true }).where(eq(cycle.id, cycleId));
  });
}
