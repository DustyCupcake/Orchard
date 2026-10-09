import { integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";

export const eventProposalStatusEnum = pgEnum("event_proposal_status", [
  "proposed",
  "conflict",
  "confirmed",
  "declined",
]);

export const eventProposalInterestLevelEnum = pgEnum("event_proposal_interest_level", ["yes", "maybe"]);

// A community's own internal programme — see docs/spec.md's "Event
// scheduling" and docs/development-plan.md's Phase 28. `status` is a
// real, persisted column recomputed by
// src/lib/event-scheduling/conflicts.ts's recomputeEventConflicts
// whenever the scheduling-owner reviews proposals — not purely
// derived on read, since a submitter editing their own slots shouldn't
// silently reinterpret a stale `conflict` label without the owner's
// next look confirming it's actually cleared.
export const eventProposal = pgTable("event_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // Optional association with a real Cycle, when cycles are on — the
  // same pattern Task/BudgetCycle already use.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => member.id),
  // Text, not a member reference — "may differ from the submitter,
  // proposing on someone else's behalf" (spec). Nothing here grants
  // the named host any special access; edit rights stay with
  // submittedBy.
  host: text("host").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  // Nullable — a session with no particular space requirement never
  // participates in a space-based conflict (see conflicts.ts).
  spaceNeeds: text("space_needs"),
  // Array of {startsAt, endsAt} — the times the proposer painted as
  // possible, NOT a fixed placement. A host paints half-hour cells and a
  // run of touching cells becomes one window here; a window may be longer
  // than durationMinutes, because "I'm free Thursday afternoon" is more
  // useful to the person scheduling than one pinned start. The owner
  // picks a concrete start inside a window at confirmation time — see
  // src/lib/event-scheduling/availability.ts.
  //
  // Conflict detection compares every window here (or confirmedSlot, once
  // set) against every other proposal's, per docs/development-plan.md's
  // resolved interpretation ("overlapping time range + an exact
  // spaceNeeds string match"). A proposal predating painted availability
  // holds a single window equal to its own duration, which reads back as
  // "only this exact time works" — correct, and why the column didn't need
  // migrating.
  preferredSlots: jsonb("preferred_slots").notNull().default([]),
  status: eventProposalStatusEnum("status").notNull().default("proposed"),
  // {startsAt, endsAt}, nullable until the owner confirms — a concrete
  // placement, unlike the availability above. Deliberately not constrained
  // to one of preferredSlots: a compromise can fall outside what either
  // host painted ("compromise, swap, or combine" — spec), and since the
  // windows are ranges now, a placement inside one is a matter of picking
  // a start rather than matching a row.
  confirmedSlot: jsonb("confirmed_slot"),
  // Set once, in bulk, when the owner publishes — doubles as both the
  // edit-lock and the /schedule visibility gate, so "the schedule" is
  // just every proposal with this set, no separate storage (the same
  // "one database, many lenses" principle Documentation's task-wiki
  // index already uses).
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Flagged proposals' hosts get pinged" — owner-initiated, one row per
// nudge, the same lightweight shape coordinatorPing already
// established (no detail required, visible until the underlying
// conflict clears). Direction is reversed from coordinatorPing (the
// owner pings the host here, not the other way around), so this is a
// new table rather than a literal reuse of that one.
export const eventProposalConflictPing = pgTable("event_proposal_conflict_ping", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => eventProposal.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "I'd come to this" — a member's non-binding interest in a proposal that
// is still open, so the person planning the programme can see how much
// appetite there is before deciding anything. Deliberately not a vote: it
// decides nothing, and absence of a row means no response rather than no.
// One row per member per proposal (the unique constraint), changed or
// withdrawn by upserting or deleting it. Counts are visible to every
// member; who is behind them only to the proposal's submitter and the
// scheduling owner — see src/lib/event-scheduling/interest.ts.
export const eventProposalInterest = pgTable(
  "event_proposal_interest",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => eventProposal.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    level: eventProposalInterestLevelEnum("level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("event_proposal_interest_member_unique").on(t.proposalId, t.memberId)],
);
