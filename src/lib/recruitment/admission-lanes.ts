import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { admissionLane, joiningLane, joiningLaneKind, joiningVerificationMode } from "@/db/schema";
import type { AdmissionLaneKind, AdmissionVerification, JoinLaneKind, JoiningVerificationMode } from "@/db/schema";
import { JOINING_LANE_COPY, JOINING_LANE_DEFAULTS } from "./lanes";

/**
 * The three mutually exclusive inviter declarations. Exactly one is true
 * per invite — the schema enforces this at invite creation (the picker
 * only allows one of the three).
 */
export type InviterDeclaration =
  | "knows_personally"     // both marks ticked
  | "good_fit_only"        // only thinks they'd fit
  | "neither";             // neither mark

/**
 * Which lane handles a given declaration, for a given community.
 * Lanes are community-wide (§2a: events choose which lanes are open,
 * they don't override them), so there's no cycle scoping on the lane
 * table itself.
 *
 * Falls back to the old joining_lane table if no admission_lane row
 * exists yet (transition period after migration 0089).
 */
export async function resolveInviteLane(
  communityId: string,
  declaration: InviterDeclaration,
): Promise<typeof admissionLane.$inferSelect | null> {
  const handleColumn = declaration === "knows_personally"
    ? admissionLane.handlesKnowsPersonally
    : declaration === "good_fit_only"
      ? admissionLane.handlesGoodFitOnly
      : admissionLane.handlesNeither;

  const [row] = await db
    .select()
    .from(admissionLane)
    .where(
      and(
        eq(admissionLane.communityId, communityId),
        eq(handleColumn, true),
        eq(admissionLane.kind, "invite"),
        isNull(admissionLane.archivedAt),
      ),
    )
    .limit(1);
  if (row) return row;

  // Fallback 1: resolve from the old joining_lane table (community-wide rows only)
  const oldLaneMap: Record<InviterDeclaration, JoinLaneKind> = {
    knows_personally: "invited_knows_personally",
    good_fit_only: "invited_good_fit",
    neither: "invited_neither",
  };
  const oldLaneKind = oldLaneMap[declaration];
  const [oldRow] = await db
    .select()
    .from(joiningLane)
    .where(
      and(
        eq(joiningLane.communityId, communityId),
        isNull(joiningLane.cycleId),
        eq(joiningLane.lane, oldLaneKind),
      ),
    )
    .limit(1);
  if (oldRow) {
    // Convert to the new shape so callers don't need to know which table it came from
    return {
      id: oldRow.id,
      communityId: oldRow.communityId,
      name: JOINING_LANE_COPY[oldLaneKind].title,
      kind: "invite" as AdmissionLaneKind,
      handlesKnowsPersonally: declaration === "knows_personally",
      handlesGoodFitOnly: declaration === "good_fit_only",
      handlesNeither: declaration === "neither",
      publicSlug: null,
      applicationRequired: oldRow.applicationRequired,
    interviewRequired: oldRow.interviewRequired,
    verification: oldRow.verificationMode === "consensus" ? "community_check" : "none",
    reportsNeeded: oldRow.applicationRequired || oldRow.interviewRequired ? 2 : null,
    supportShortcutCount: oldRow.verificationMode === "nomination" ? oldRow.supportCount : null,
    archivedAt: null,
    createdAt: oldRow.updatedAt,
    updatedAt: oldRow.updatedAt,
  } as typeof admissionLane.$inferSelect;
}

// Fallback 2: the documented defaults (same as JOINING_LANE_DEFAULTS)
const defaultRule = JOINING_LANE_DEFAULTS[oldLaneKind];
return {
  id: `default-${oldLaneKind}`,
  communityId,
  name: JOINING_LANE_COPY[oldLaneKind].title,
  kind: "invite" as AdmissionLaneKind,
  handlesKnowsPersonally: declaration === "knows_personally",
  handlesGoodFitOnly: declaration === "good_fit_only",
  handlesNeither: declaration === "neither",
  publicSlug: null,
  applicationRequired: defaultRule.applicationRequired,
  interviewRequired: defaultRule.interviewRequired,
  verification: "none" as AdmissionVerification,
  reportsNeeded: defaultRule.applicationRequired || defaultRule.interviewRequired ? 2 : null,
  supportShortcutCount: defaultRule.verificationMode === "nomination" ? defaultRule.supportCount : null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as typeof admissionLane.$inferSelect;
}

/**
 * Resolve the public lane for a given community, and optionally a slug
 * (for `/apply/<name>`). If no slug is given, returns the first public
 * lane (which is served at `/apply`).
 *
 * Falls back to the old joining_lane table if no admission_lane row
 * exists yet.
 */
export async function resolvePublicLane(
  communityId: string,
  slug?: string | null,
): Promise<typeof admissionLane.$inferSelect | null> {
  const rows = await db
    .select()
    .from(admissionLane)
    .where(
      and(
        eq(admissionLane.communityId, communityId),
        eq(admissionLane.kind, "public"),
        isNull(admissionLane.archivedAt),
        slug ? eq(admissionLane.publicSlug, slug) : sql`TRUE`,
      ),
    );

  // If a slug was given, exact match only (the unique index guarantees one).
  if (slug && rows[0]) return rows[0];
  if (!slug && rows[0]) return rows[0];

  // Fallback: the old public_application lane from joining_lane
  const [oldRow] = await db
    .select()
    .from(joiningLane)
    .where(
      and(
        eq(joiningLane.communityId, communityId),
        isNull(joiningLane.cycleId),
        eq(joiningLane.lane, "public_application"),
      ),
    )
    .limit(1);
  if (oldRow) {
    return {
      id: oldRow.id,
      communityId: oldRow.communityId,
      name: JOINING_LANE_COPY.public_application.title,
      kind: "public" as AdmissionLaneKind,
      handlesKnowsPersonally: false,
      handlesGoodFitOnly: false,
      handlesNeither: false,
      publicSlug: null,
      applicationRequired: oldRow.applicationRequired,
      interviewRequired: oldRow.interviewRequired,
      verification: oldRow.verificationMode === "consensus" ? "community_check" : "none",
      reportsNeeded: oldRow.applicationRequired || oldRow.interviewRequired ? 2 : null,
      supportShortcutCount: oldRow.verificationMode === "nomination" ? oldRow.supportCount : null,
      archivedAt: null,
      createdAt: oldRow.updatedAt,
      updatedAt: oldRow.updatedAt,
    } as typeof admissionLane.$inferSelect;
  }

  // Fallback 2: the documented defaults
  const defaultRule = JOINING_LANE_DEFAULTS.public_application;
  return {
    id: "default-public_application",
    communityId,
    name: JOINING_LANE_COPY.public_application.title,
    kind: "public" as AdmissionLaneKind,
    handlesKnowsPersonally: false,
    handlesGoodFitOnly: false,
    handlesNeither: false,
    publicSlug: null,
    applicationRequired: defaultRule.applicationRequired,
    interviewRequired: defaultRule.interviewRequired,
    verification: "none" as AdmissionVerification,
    reportsNeeded: defaultRule.applicationRequired || defaultRule.interviewRequired ? 2 : null,
    supportShortcutCount: defaultRule.verificationMode === "nomination" ? defaultRule.supportCount : null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as typeof admissionLane.$inferSelect;
}

/**
 * The snapshot of a lane's path, for writing onto an arrival.
 * Mirrors the fields in admission.requiredSteps.
 */
export type AdmissionLaneSnapshot = {
  requiredVerification: AdmissionVerification;
  requiredApplication: boolean;
  requiredInterview: boolean;
  requiredEvaluation: boolean;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
};

/**
 * Build the snapshot from a lane row. This is the single place the
 * mapping lives, so the two entry points (apply + redeem) are guaranteed
 * to snapshot the same way.
 */
export function laneSnapshot(lane: typeof admissionLane.$inferSelect): AdmissionLaneSnapshot {
  const requiredEvaluation = lane.applicationRequired || lane.interviewRequired;
  return {
    requiredVerification: lane.verification,
    requiredApplication: lane.applicationRequired,
    requiredInterview: lane.interviewRequired,
    requiredEvaluation,
    reportsNeeded: lane.reportsNeeded,
    supportShortcutCount: lane.supportShortcutCount,
  };
}

/**
 * Determine the declaration from an invite's marks. The inviter's two
 * checkboxes are mutually exclusive in the UI (the picker only allows
 * one of the three), so this is a direct mapping.
 */
export function declarationFromInvite(invite: {
  inviterKnowsPersonally: boolean;
  inviterThinksGoodFit: boolean;
}): InviterDeclaration {
  if (invite.inviterKnowsPersonally) return "knows_personally";
  if (invite.inviterThinksGoodFit) return "good_fit_only";
  return "neither";
}

/**
 * Is this lane open in the given context (cycle or community-wide)?
 *
 * A lane is "open" if it exists and is not archived. The question of
 * whether a community/cycle *offers* a lane to applicants is a different
 * question (the context's list of open lanes), but this function answers
 * "does this lane exist and is it active?".
 *
 * For invite lanes, we also check that it handles at least one declaration.
 * For public lanes, we check it has a slug (or is the default first lane).
 */
export async function isLaneOpen(
  communityId: string,
  laneId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: admissionLane.id, archivedAt: admissionLane.archivedAt })
    .from(admissionLane)
    .where(
      and(
        eq(admissionLane.id, laneId),
        eq(admissionLane.communityId, communityId),
        isNull(admissionLane.archivedAt),
      ),
    );
  return !!row;
}

/**
 * Create an empty lane rule with defaults. Used when adding a new lane.
 */
export function createEmptyLane(): AdmissionLaneRule {
  return {
    kind: "invite",
    name: "",
    handlesKnowsPersonally: false,
    handlesGoodFitOnly: false,
    handlesNeither: false,
    publicSlug: null,
    applicationRequired: true,
    interviewRequired: true,
    verification: "none",
    reportsNeeded: 2,
    supportShortcutCount: null,
  };
}

/**
 * Generate a human-readable consequence sentence for a lane rule.
 * This is the single source of truth for what a lane does — the same
 * sentence is shown in the settings panel and can be used in tests.
 */
export function describeLaneConsequence(rule: AdmissionLaneRule): string {
  const parts: string[] = [];

  // Verification
  if (rule.verification === "community_check") {
    parts.push("community check");
  } else {
    parts.push("no community check");
  }

  // Process
  const processParts: string[] = [];
  if (rule.applicationRequired) parts.push("application");
  if (rule.interviewRequired) parts.push("interview");
  if (parts.length === 0) {
    parts.push("admitted immediately");
  } else {
    parts.push(parts.join(", "));
  }

  // Reports needed
  if (rule.reportsNeeded !== null) {
    parts.push(`${rule.reportsNeeded} report${rule.reportsNeeded === 1 ? "" : "s"} needed`);
  }

  // Support shortcut
  if (rule.supportShortcutCount !== null && rule.supportShortcutCount > 0) {
    parts.push(`${rule.supportShortcutCount} support${rule.supportShortcutCount === 1 ? "" : "s"} to skip the rest`);
  }

  return parts.join("; ") + ".";
}

export type AdmissionLaneRule = {
  kind: "invite" | "public";
  name: string;
  handlesKnowsPersonally: boolean;
  handlesGoodFitOnly: boolean;
  handlesNeither: boolean;
  publicSlug: string | null;
  applicationRequired: boolean;
  interviewRequired: boolean;
  verification: AdmissionVerification;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
};

export type InitialLaneRules = Array<AdmissionLaneRule & { id?: string }>;