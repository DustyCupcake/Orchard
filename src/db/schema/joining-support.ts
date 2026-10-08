import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { communityInvite } from "./community-invite";
import { formResponse } from "./form";
import { member } from "./member";

// Nomination, the one verification mode that needs storage of its own
// (docs/plans/archive/joining-admission-plan.md §2.2/§2.4/§4.2). A nomination is a
// *subject* waiting for social proof: either an invite whose lane
// resolved to `nomination`, or a public application whose lane did.
// One table for both rather than two parallel sets of columns on
// community_invite and form_response, because the support machinery is
// identical for them and because the plan's "one link, auth-branched"
// (§2.4) wants a single token family — see supportToken below.
//
// The plan's J6 is the reason this row has a state machine at all: a
// support window that lapses must *fall through* to the lane's process
// path, never auto-fail. There is no `rejected` state here precisely
// because there is no auto-fail; `lapsed` means "the window closed
// without enough support, and the subject carries on as if the
// nomination had never been asked for".
export const joiningNominationStateEnum = pgEnum("joining_nomination_state", [
  "awaiting",
  "supported",
  "skipped",
  "lapsed",
]);

// §2.4 — "One link, auth-branched": the same token renders the support
// view to a logged-in member and the (paired) application to everyone
// else. Plaintext, same reasoning as communityInvite.token and
// recruitmentDecision.introCallToken: a human-relayed, shareable link
// that has to be re-readable after the fact (the inviter handing it to
// a second person, the applicant pasting it into a group chat) rather
// than a single-glance login token.
export const joiningNomination = pgTable(
  "joining_nomination",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    // Exactly one of these two is set, enforced at the application
    // layer rather than by a DB check constraint — the same posture
    // schedulingEntry's memberId/formResponseId pair already takes in
    // this schema (see scheduling-poll.ts's own comment on why).
    inviteId: uuid("invite_id").references(() => communityInvite.id),
    formResponseId: uuid("form_response_id").references(() => formResponse.id),
    // The lane whose rule put this subject in a support window — kept
    // as a fact rather than re-derived, because the support page has to
    // explain *why* it is asking before the subject can be told anything
    // about the lane's own process.
    supportToken: text("support_token").notNull().unique(),
    state: joiningNominationStateEnum("state").notNull().default("awaiting"),
    // §2.5/J6 — "at any time during the window, the invitee can choose
    // 'skip the nomination, I'll do the application instead'". The
    // window's other end is `deadline`; past it the scheduled job
    // marks the nomination `lapsed`, which falls through rather than
    // failing (see src/lib/recruitment/support.ts).
    deadline: timestamp("deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One nomination per subject — an invite that gets re-sent or an
    // application that is somehow resubmitted must not accumulate
    // competing support windows.
    uniqueIndex("joining_nomination_invite_idx").on(t.inviteId),
    uniqueIndex("joining_nomination_response_idx").on(t.formResponseId),
  ],
);

// Who vouched, when, and on what terms (§2.4: "recording their own
// knowsPersonally/thinksGoodFit marks"). The mark matters: a supporter
// who knows the person personally is a materially stronger piece of
// proof than one who only thinks they'd fit, and the plan makes the
// supporter's own declaration — not the inviter's — the thing recorded
// here.
//
// No DB-level unique constraint on (nominationId, supporterId): the
// same "resubmittable in place, upserted in code" posture
// src/db/schema/recruitment.ts's `evaluation` table already takes for
// the same reason (a supporter changing their own mind before the
// window closes is a real, low-stakes case, and a partial unique index
// is not serializable by this repo's drizzle-kit — see
// src/db/schema/joining-lane.ts's table comment).
export const joiningSupport = pgTable("joining_support", {
  id: uuid("id").primaryKey().defaultRandom(),
  nominationId: uuid("nomination_id")
    .notNull()
    .references(() => joiningNomination.id),
  supporterId: uuid("supporter_id")
    .notNull()
    .references(() => member.id),
  knowsPersonally: boolean("knows_personally").notNull().default(false),
  thinksGoodFit: boolean("thinks_good_fit").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
