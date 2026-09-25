import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { joiningLane } from "@/db/schema";
import type { JoinLaneKind, JoiningVerificationMode } from "@/db/schema";

// Lane resolution for the admission redesign (docs/joining-admission-
// plan.md §2, §4.1): every newcomer's declaration picks a lane, and the
// community's rule for that lane is the whole path. This module turns an
// invite (or the raw declaration) into the governing rule — a cycle's
// own row first, then the community-wide row, then the locked §2.9
// defaults. The code-level default matters as much as the migration's
// seed: resetDatabase truncates communities (cascade-wiping any lane
// rows) and communities created after the seeding migration have none,
// so resolution must never depend on rows existing.
export type JoiningLaneRule = {
  verificationMode: JoiningVerificationMode;
  supportCount: number;
  applicationRequired: boolean;
  interviewRequired: boolean;
  applyInsteadAvailable: boolean;
};

// §2.9 — the default configuration reproduces today's behavior: knows-
// personally = today's `direct` (basic, no process); vouches and
// neither = today's `referral` (basic, full process); public = today's
// `/apply`. Nomination/consensus are opt-in upgrades (§2.9: "nothing
// changes until it does").
export const JOINING_LANE_DEFAULTS: Record<JoinLaneKind, JoiningLaneRule> = {
  invited_knows_personally: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: false,
    interviewRequired: false,
    applyInsteadAvailable: true,
  },
  invited_good_fit: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
  invited_neither: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
  public_application: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
};

function rowToRule(row: typeof joiningLane.$inferSelect): JoiningLaneRule {
  return {
    verificationMode: row.verificationMode,
    supportCount: row.supportCount,
    applicationRequired: row.applicationRequired,
    interviewRequired: row.interviewRequired,
    applyInsteadAvailable: row.applyInsteadAvailable,
  };
}

type InviteLike = { inviterThinksGoodFit: boolean; inviterKnowsPersonally: boolean };

// §2.1 — the inviter's declaration fixes the lane at send time; both
// marks count as knows-personally (the stronger signal, J4).
export function joiningLaneForInvite(invite: InviteLike): JoinLaneKind {
  if (invite.inviterKnowsPersonally) return "invited_knows_personally";
  if (invite.inviterThinksGoodFit) return "invited_good_fit";
  return "invited_neither";
}

// §2.2/§2.3 — a lane admits straight away only on the very light path:
// basic verification with no application form and no interview. Any
// other configuration routes through the evaluated application funnel.
export function laneRedemptionKind(rule: JoiningLaneRule): "direct" | "process" {
  return rule.verificationMode === "basic" && !rule.applicationRequired && !rule.interviewRequired
    ? "direct"
    : "process";
}

// The resolved rule for one (community, cycle, lane) — cycle's own row
// if it has one, the community-wide row otherwise, §2.9 defaults if
// neither exists.
export async function getJoinLaneRule(
  communityId: string,
  cycleId: string | null,
  lane: JoinLaneKind,
): Promise<JoiningLaneRule> {
  const rules = await getJoinLaneRulesForContext(communityId, cycleId);
  return rules.get(lane) ?? JOINING_LANE_DEFAULTS[lane];
}

// Resolves all four lanes for a joining context (a cycle, or the
// community-wide general door when cycleId is null): cycle-scoped rows
// override the community-wide ones, which override the defaults.
export async function getJoinLaneRulesForContext(
  communityId: string,
  cycleId: string | null,
): Promise<Map<JoinLaneKind, JoiningLaneRule>> {
  const scoped = cycleId
    ? await db
        .select()
        .from(joiningLane)
        .where(and(eq(joiningLane.communityId, communityId), eq(joiningLane.cycleId, cycleId)))
    : [];
  const communityRows = await db
    .select()
    .from(joiningLane)
    .where(and(eq(joiningLane.communityId, communityId), isNull(joiningLane.cycleId)));

  const rules = new Map<JoinLaneKind, JoiningLaneRule>();
  for (const row of communityRows) {
    rules.set(row.lane, rowToRule(row));
  }
  for (const row of scoped) {
    rules.set(row.lane, rowToRule(row));
  }
  for (const lane of Object.keys(JOINING_LANE_DEFAULTS) as JoinLaneKind[]) {
    if (!rules.has(lane)) rules.set(lane, JOINING_LANE_DEFAULTS[lane]);
  }
  return rules;
}

// The redemption kind for a specific invite — its lane from the marks
// on the row, its rule from the resolved context map.
export function redemptionKindForInvite(
  invite: InviteLike,
  rules: Map<JoinLaneKind, JoiningLaneRule>,
): "direct" | "process" {
  return laneRedemptionKind(rules.get(joiningLaneForInvite(invite)) ?? JOINING_LANE_DEFAULTS.invited_neither);
}

// One-shot for callers holding a single invite (redeem, /apply, the
// public /invite page): loads that invite's context and resolves it.
export async function getInviteRedemptionKind(
  communityId: string,
  invite: InviteLike & { cycleId: string | null },
): Promise<"direct" | "process"> {
  const rules = await getJoinLaneRulesForContext(communityId, invite.cycleId);
  return redemptionKindForInvite(invite, rules);
}