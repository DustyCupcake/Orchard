import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";

// docs/admission-flow.md §2a — a lane is a row, not a value in a fixed
// four-value enum. A community defines only the lanes it needs; what a
// lane *is* is still decided by facts the system already has, never by
// something an inviter or applicant picks from a menu:
//
//   - an **invite lane** matches on the inviter's own declaration, and
//     says which of the three declarations it handles. The three are
//     mutually exclusive (both marks ticked counts as knows-personally,
//     per J4), so three booleans is the honest shape and "which of those
//     three it handles" (§2a) is literally what is stored.
//   - a **public lane** matches on the link the person arrived by, so it
//     carries the slug that link is served at.
//
// `kind` is what tells those two apart, and it is what the "every
// declaration belongs to exactly one invite lane" rule is checked
// against — in code, by the settings panel (§2a), because that
// uniqueness is over a *subset* of the community's lanes and so is not
// expressible as a row constraint.
//
// Nothing here is scoped per cycle. §2a decides that an event chooses
// which lanes are open for it rather than overriding one, and §7 retires
// the per-event override rows, so a lane has one community-wide identity
// and a context-local question ("is this lane open here?") that step 6
// answers.
export const admissionLaneKind = pgEnum("admission_lane_kind", ["invite", "public"]);
export const ADMISSION_LANE_KINDS = ["invite", "public"] as const;
export type AdmissionLaneKind = (typeof ADMISSION_LANE_KINDS)[number];

// The plan's own vocabulary, not the old joining_lane's
// basic|nomination|consensus. §3 reduces verification to two shapes —
// none, or a community check — and §2 deletes nomination outright, so
// there is no third value to carry. The old `nomination` is carried over
// as `none` *with its support shortcut intact*, which is the honest
// translation: the community wanted other members' word on that lane, and
// support still exists, it just runs alongside the path instead of in
// front of it (§2, the support shortcut). Dropping the shortcut instead
// would quietly throw away a decision somebody had made.
export const admissionVerification = pgEnum("admission_verification", ["none", "community_check"]);
export const ADMISSION_VERIFICATIONS = ["none", "community_check"] as const;
export type AdmissionVerification = (typeof ADMISSION_VERIFICATIONS)[number];

export const admissionLane = pgTable(
  "admission_lane",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    name: text("name").notNull(),

    kind: admissionLaneKind("kind").notNull(),

    // Invite lanes: which of the three mutually exclusive inviter
    // declarations this lane handles. Exactly one lane per declaration
    // per community, enforced by the settings panel (§2a) — not by a
    // constraint, since a lane may handle several and the community's set
    // of open lanes varies by context.
    handlesKnowsPersonally: boolean("handles_knows_personally").notNull().default(false),
    handlesGoodFitOnly: boolean("handles_good_fit_only").notNull().default(false),
    handlesNeither: boolean("handles_neither").notNull().default(false),

    // Public lanes: the address the lane's application is served at.
    // §2a puts the first public lane at `/apply` and the rest at
    // `/apply/<name>`, so this is the part of the address after
    // `/apply/`. Null for invite lanes, which have no address.
    publicSlug: text("public_slug"),

    // The process (§2). Both off means admitted immediately, and the
    // panel says so in as many words.
    applicationRequired: boolean("application_required").notNull().default(true),
    interviewRequired: boolean("interview_required").notNull().default(true),

    verification: admissionVerification("verification").notNull().default("none"),

    // Reports needed (§2). Null rather than 0 when the lane has nothing
    // to evaluate — a community-check lane has no application and no
    // interview, so there is nothing for a report to be about, and 0 would
    // read as "needs no reports" instead of "there is no evaluation here".
    reportsNeeded: integer("reports_needed"),

    // The support shortcut (§2). Null = off. Only offerable when the lane
    // has something to skip, which §3 enforces in the panel.
    supportShortcutCount: integer("support_shortcut_count"),

    // Whether the community's own general door has this lane open. An event
    // chooses its own set (cycle_admission_lane) or follows this one, and a
    // community whose recruiting is entirely event-by-event has none open
    // here (§2a). Archived is a different thing: archived lanes are open
    // nowhere and take nobody new.
    openInCommunity: boolean("open_in_community").notNull().default(true),

    // §2a: lanes are archived, not deleted. People in the funnel keep the
    // path they entered on, and an invite already issued under an
    // archived lane is held rather than revoked.
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A community-defined lane list still wants to not have two lanes
    // called the same thing — the card and the panel both key off the
    // name, and "Add lane" would otherwise be able to make a duplicate
    // that nothing can tell apart.
    uniqueIndex("admission_lane_community_name_idx").on(t.communityId, t.name),
    // Two public lanes cannot serve one address, for the obvious reason
    // that the second would be unreachable.
    uniqueIndex("admission_lane_community_public_slug_idx").on(t.communityId, t.publicSlug),
  ],
);

// Note on what is *not* enforced here, so nobody has to re-derive it:
//
//   - An invite lane handles at least one declaration, and a public lane
//     handles none and has a slug. Both are panel rules (§3: "A
//     configuration that can't produce a person's path is refused when
//     saved, with a sentence saying why"), because they are about
//     whether a *configuration* makes sense, which is a question about
//     several fields at once.
//   - Reports needed and the support shortcut are only offered when the
//     lane has an application or an interview on. Same reason.
//   - Whether a policy can actually be met — "at least 3 yes" on a lane
//     that needs 2 reports (§2) — needs the community's decision form as
//     well as the lane, so it is checked where both are visible.
//
// The application-side shape of a lane, and the single place a stored row
// becomes one, is resolveAdmissionLaneRow in
// src/lib/recruitment/admission-lanes.ts. That file — not this one — is
// what type-checks the assignment in both directions, for the same
// reason joining-lanes.ts did it for the table it replaced.

// The lanes an event has chosen to open, when it has its own set
// (`cycle.own_admission_lanes`). A row is "this lane is open in this
// event"; absence is closed. Nothing else about a lane varies by event.
export const cycleAdmissionLane = pgTable(
  "cycle_admission_lane",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => cycle.id, { onDelete: "cascade" }),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => admissionLane.id),
  },
  (t) => [uniqueIndex("cycle_admission_lane_unique").on(t.cycleId, t.laneId)],
);
