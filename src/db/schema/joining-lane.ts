import { boolean, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";

// docs/joining-admission-plan.md §2/§4.1 — one join rule per lane per
// *context*: the four lanes that fix a newcomer's path
// (docs/joining-admission-plan.md §2.1) are configured per-lane, with a
// cycle that differs from the community-wide default getting its own
// row. `cycleId` null = the community-wide row; a row with a cycleId
// scopes a specific cycle and overrides it. Resolution follows the
// §4.1/2d chain — the cycle's own row, else the community-wide,
// else the §2.9 seeded defaults (never snapshotted; always read live
// from what the context declares, the same "mode-following, never
// snapshotted" rule invites always kept).
//
// Uniqueness (one rule per lane per scope) is enforced in code rather
// than with a drizzle partial `where` index: drizzle-kit 0.30.6 cannot
// serialize `index.where` against drizzle-orm 0.36.4 ("sql is not a
// function"), and every other build in this schema is a plain index.
// The composite (community_id, cycle_id, lane) index below still
// guarantees no two *cycle-scoped* rows for the same (cycle, lane); the
// community-wide rows (cycleId NULL) are kept single by the seed — the
// rolling seed here and the §2.9 code fallback both insert/read exactly
// four rows, never duplicated — and by getJoinLaneRulesForContext
// (src/lib/recruitment/joining-lanes.ts) which resolves the community
// row on uniqueness of (communityId, lane) itself.
export const joiningLaneKind = pgEnum("joining_lane_kind", [
  "invited_knows_personally",
  "invited_good_fit",
  "invited_neither",
  "public_application",
]);
export const JOINING_LANE_KINDS = [
  "invited_knows_personally",
  "invited_good_fit",
  "invited_neither",
  "public_application",
] as const;
export type JoinLaneKind = (typeof JOINING_LANE_KINDS)[number];

export const joiningVerificationMode = pgEnum("joining_verification_mode", [
  "basic",
  "nomination",
  "consensus",
]);
export const JOINING_VERIFICATION_MODES = ["basic", "nomination", "consensus"] as const;
export type JoiningVerificationMode = (typeof JOINING_VERIFICATION_MODES)[number];

export const joiningLane = pgTable(
  "joining_lane",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    // Null = the community-wide rule every cycle falls back to; present
    // = this specific cycle's override (docs/joining-admission-plan.md
    // §4.1/2d).
    cycleId: uuid("cycle_id").references(() => cycle.id),
    lane: joiningLaneKind("lane").notNull(),
    verificationMode: joiningVerificationMode("verification_mode").notNull().default("basic"),
    // §2.9 — how many settled supports a nomination lane needs before
    // it can opt out (supportCount); 1 for the invoked lanes by default.
    supportCount: integer("support_count").notNull().default(1),
    applicationRequired: boolean("application_required").notNull().default(true),
    interviewRequired: boolean("interview_required").notNull().default(true),
    applyInsteadAvailable: boolean("apply_instead_available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per lane per scope — see the table comment for why the
    // single-row-per-community-wide-lane part is code-enforced.
    uniqueIndex("joining_lane_community_cycle_lane_idx").on(t.communityId, t.cycleId, t.lane),
  ],
);

// §2.9 table — the defaults a fresh community gets, blocking a manual
// admission-design decision where the plan deliberately leaves spaces
// open to a community to bargain: it must be *possible* to reproduce
// today's three doors from one place, and the "real" default
// (nomination/consensus) is what the migration seeds. The exact
// "rows to seed" derivation is in docs/joining-admission-plan.md §2.9.
export type JoiningLaneRule = {
  verificationMode: JoiningVerificationMode;
  supportCount: number;
  applicationRequired: boolean;
  interviewRequired: boolean;
  applyInsteadAvailable: boolean;
};
