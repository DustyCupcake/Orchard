import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { joiningLane } from "@/db/schema";
import type { JoinLaneKind } from "@/db/schema";
import {
  JOINING_LANE_DEFAULTS,
  joiningLaneForInvite,
  laneRedemptionKind,
  pathHoldsCapacity,
  redemptionPathForRule,
  settledPathForRule,
  type JoiningLaneRule,
  type JoiningRedemptionPath,
} from "./lanes";

// The one place a stored row becomes an application-side rule. The
// duplication between this module's rule type and the schema file's
// column list is deliberate and documented on both sides
// (src/db/schema/joining-lane.ts can't import a lib file without turning
// the db layer into a dependant of the application layer), and this
// function is what keeps them honest: it is the only projection between
// the two, so a column added on one side and not the other fails to
// compile here rather than silently reading undefined at runtime.
function resolveLaneRuleRow(row: typeof joiningLane.$inferSelect): JoiningLaneRule {
  return {
    verificationMode: row.verificationMode,
    supportCount: row.supportCount,
    applicationRequired: row.applicationRequired,
    interviewRequired: row.interviewRequired,
    applyInsteadAvailable: row.applyInsteadAvailable,
  };
}

export { JOINING_LANE_DEFAULTS, joiningLaneForInvite, laneRedemptionKind, pathHoldsCapacity, redemptionPathForRule, settledPathForRule };
export type { JoiningLaneRule, JoiningRedemptionPath };

// Lane resolution for the admission redesign (docs/joining-admission-
// plan.md §2, §4.1): every newcomer's declaration picks a lane, and the
// community's rule for that lane is the whole path. This module turns an
// invite (or the raw declaration) into the governing rule — a cycle's
// own row first, then the community-wide row, then the locked §2.9
// defaults. The code-level default matters as much as the migration's
// seed: resetDatabase truncates communities (cascade-wiping any lane
// rows) and communities created after the seeding migration have none,
// so resolution must never depend on rows existing.
//
// The pure half — the rule shape, its defaults, the copy, the presets —
// is in ./lanes, which imports no db, so the same definitions can be
// rendered by the settings panel's client-side lane editor. Re-exported
// here because `@/lib/recruitment` is a flat barrel and importers should
// not have to know which file is which.

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
//
// Community-wide rows are resolved *by* (communityId, lane) rather than
// trusted positionally: the schema's uniqueness on (communityId,
// cycleId, lane) cannot enforce one row per lane for the cycle-less
// case, because NULLs are distinct in a Postgres unique index (see
// src/db/schema/joining-lane.ts's table comment for the drizzle-kit
// reason behind not using a partial index). Last-write-wins here means
// a duplicated community-wide row is a visible "whichever was set most
// recently" rather than an arbitrary pick.
export async function getJoinLaneRulesForContext(
  communityId: string,
  cycleId: string | null,
): Promise<Map<JoinLaneKind, JoiningLaneRule>> {
  const [scoped, communityRows] = await Promise.all([
    cycleId
      ? db
          .select()
          .from(joiningLane)
          .where(and(eq(joiningLane.communityId, communityId), eq(joiningLane.cycleId, cycleId)))
      : Promise.resolve([]),
    db
      .select()
      .from(joiningLane)
      .where(and(eq(joiningLane.communityId, communityId), isNull(joiningLane.cycleId))),
  ]);

  const rules = new Map<JoinLaneKind, JoiningLaneRule>();
  for (const row of [...communityRows, ...scoped].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())) {
    rules.set(row.lane, resolveLaneRuleRow(row));
  }
  for (const lane of Object.keys(JOINING_LANE_DEFAULTS) as JoinLaneKind[]) {
    if (!rules.has(lane)) rules.set(lane, JOINING_LANE_DEFAULTS[lane]);
  }
  return rules;
}

// The path a specific invite takes — its lane from the marks on the row,
// its rule from the resolved context map.
export function redemptionPathForInvite(
  invite: { inviterThinksGoodFit: boolean; inviterKnowsPersonally: boolean },
  rules: Map<JoinLaneKind, JoiningLaneRule>,
): JoiningRedemptionPath {
  return redemptionPathForRule(rules.get(joiningLaneForInvite(invite)) ?? JOINING_LANE_DEFAULTS.invited_neither);
}

// One-shot for callers holding a single invite (redeem, /apply, the
// public /invite page): loads that invite's context and resolves it.
export async function getInviteRedemptionPath(
  communityId: string,
  invite: { inviterThinksGoodFit: boolean; inviterKnowsPersonally: boolean; cycleId: string | null },
): Promise<JoiningRedemptionPath> {
  const rules = await getJoinLaneRulesForContext(communityId, invite.cycleId);
  return redemptionPathForInvite(invite, rules);
}

// ---------------------------------------------------------------------------
// The write side
// ---------------------------------------------------------------------------

// One lane's rule, as a form hands it over. `null` supportCount /
// booleans mean "leave whatever is there" is *not* how this works: the
// settings form always submits the whole card, because a partially
// submitted card is exactly how a community ends up with a lane whose
// process it never chose. The "inherit" case is a whole card absent, not
// a field absent.
export type JoiningLaneRuleInput = {
  verificationMode: "basic" | "nomination" | "consensus";
  supportCount: number;
  applicationRequired: boolean;
  interviewRequired: boolean;
  applyInsteadAvailable: boolean;
};

export const joiningLaneRuleInputSchema = z.object({
  verificationMode: z.enum(["basic", "nomination", "consensus"]),
  supportCount: z.number().int().min(1).max(50),
  applicationRequired: z.boolean(),
  interviewRequired: z.boolean(),
  applyInsteadAvailable: z.boolean(),
});

// §2.2 — the support count is a property of the nomination mechanism, so
// it is meaningless on the other two modes. Rather than store a dead
// number that the UI would have to explain, it is pinned to 1 so a lane
// switched from nomination back to basic doesn't come back carrying a
// "3 supporters" setting that never applied.
function normalizeForMode(input: JoiningLaneRuleInput): JoiningLaneRule {
  return {
    verificationMode: input.verificationMode,
    supportCount: input.verificationMode === "nomination" ? Math.max(1, input.supportCount) : 1,
    applicationRequired: input.applicationRequired,
    interviewRequired: input.interviewRequired,
    applyInsteadAvailable: input.applyInsteadAvailable,
  };
}

// Upsert on (communityId, cycleId, lane). The schema's unique index on
// all three can't serve the cycle-less case (NULLs are distinct in a
// Postgres unique index — see the table comment in
// src/db/schema/joining-lane.ts), so this checks-then-writes and relies
// on the settings form being the only writer, which it is: the cycle
// page and the community settings page both call exactly this.
async function writeLaneRule(
  communityId: string,
  cycleId: string | null,
  lane: JoinLaneKind,
  rule: JoiningLaneRule,
) {
  const existing = await db
    .select({ id: joiningLane.id })
    .from(joiningLane)
    .where(
      cycleId
        ? and(eq(joiningLane.communityId, communityId), eq(joiningLane.cycleId, cycleId), eq(joiningLane.lane, lane))
        : and(eq(joiningLane.communityId, communityId), isNull(joiningLane.cycleId), eq(joiningLane.lane, lane)),
    );
  const values = { ...rule, updatedAt: new Date() };
  if (existing.length > 0) {
    const [updated] = await db
      .update(joiningLane)
      .set(values)
      .where(eq(joiningLane.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(joiningLane)
    .values({ communityId, cycleId, lane, ...values })
    .returning();
  return created;
}

// §5.1 — the settings panel's Save. Every lane the community configured
// is written; a lane missing from `rules` is left exactly as it was
// (deliberately not deleted, so switching a preset on and off doesn't
// quietly discard a per-lane tweak nobody was looking at).
export async function setCommunityJoiningLaneRules(
  communityId: string,
  rules: Partial<Record<JoinLaneKind, JoiningLaneRuleInput>>,
) {
  const written = [];
  for (const [lane, input] of Object.entries(rules) as [JoinLaneKind, JoiningLaneRuleInput][]) {
    written.push(await writeLaneRule(communityId, null, lane, normalizeForMode(input)));
  }
  return written;
}

// §5.2 — the same, as a per-cycle override. Only the lanes the form
// actually carried a card for are written, so "inherit the community's
// rule" is the absence of a row rather than a sentinel value, and
// removing a card from the cycle's form really does hand the lane back.
export async function setCycleJoiningLaneRules(
  communityId: string,
  cycleId: string,
  rules: Partial<Record<JoinLaneKind, JoiningLaneRuleInput>>,
) {
  const written = [];
  for (const [lane, input] of Object.entries(rules) as [JoinLaneKind, JoiningLaneRuleInput][]) {
    written.push(await writeLaneRule(communityId, cycleId, lane, normalizeForMode(input)));
  }
  return written;
}

// Which lanes a cycle overrides rather than inherits, for the cycle
// config form's "this event has its own rule for…" list.
export async function listOverriddenLanes(communityId: string, cycleId: string): Promise<JoinLaneKind[]> {
  const rows = await db
    .select({ lane: joiningLane.lane })
    .from(joiningLane)
    .where(and(eq(joiningLane.communityId, communityId), eq(joiningLane.cycleId, cycleId)));
  return rows.map((r) => r.lane);
}

// Which events currently override at least one lane, community-wide.
//
// The settings screen needs this and could not answer it: an Admin editing
// a community-wide lane rule is editing a *default*, and because
// inheritance is the absence of a row rather than a snapshotted copy, that
// edit propagates to every lane that isn't overridden somewhere. So
// whether an edit reaches a given event is a function of which events
// shadow which lanes — and with no way to see that, the edit is made blind.
// The point of the never-snapshotted design is that a community default
// stays true; this is what makes that visible rather than merely intended.
export async function listLaneOverridesByCycle(
  communityId: string,
): Promise<{ cycleId: string; lanes: JoinLaneKind[] }[]> {
  const rows = await db
    .select({ cycleId: joiningLane.cycleId, lane: joiningLane.lane })
    .from(joiningLane)
    .where(and(eq(joiningLane.communityId, communityId), isNotNull(joiningLane.cycleId)));

  const byCycle = new Map<string, JoinLaneKind[]>();
  for (const r of rows) {
    if (!r.cycleId) continue;
    const list = byCycle.get(r.cycleId);
    if (list) list.push(r.lane);
    else byCycle.set(r.cycleId, [r.lane]);
  }
  return [...byCycle.entries()]
    .map(([cycleId, lanes]) => ({ cycleId, lanes: lanes.sort() }))
    .sort((a, b) => a.cycleId.localeCompare(b.cycleId));
}

// §5.2's "untick to inherit". Removing the row *is* the reset, because
// inheritance in this model is the absence of a row rather than a stored
// copy of the community's current value — so a deleted override starts
// tracking the community rule again the moment the community changes it,
// which is the same "mode-following, never snapshotted" property the read
// side has. Copying the community's rule down here instead would freeze
// it, and a frozen copy is how a per-event override quietly becomes a
// second, unmaintained version of the community's admission design.
export async function deleteCycleJoiningLaneRules(
  communityId: string,
  cycleId: string,
  lanes: JoinLaneKind[],
) {
  if (lanes.length === 0) return 0;
  const deleted = await db
    .delete(joiningLane)
    .where(
      and(
        eq(joiningLane.communityId, communityId),
        eq(joiningLane.cycleId, cycleId),
        inArray(joiningLane.lane, lanes),
      ),
    )
    .returning({ id: joiningLane.id });
  return deleted.length;
}

