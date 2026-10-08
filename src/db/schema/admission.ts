import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { admissionLane, admissionVerification } from "./admission-lane";
import { community } from "./community";
import { cycle } from "./cycle";
import { formResponse } from "./form";

// docs/admission-flow.md §4 — one row per person in the funnel, replacing
// the overlapping state that used to be spread over the invite
// (redeemedAt / revokedAt / consensusState), the nomination (state) and the
// decision (resolution).
//
// The shape is two ideas held apart on purpose:
//
//   - **`requiredSteps` is a snapshot**, taken once at entry, of what the
//     lane said at that moment. §1 principle 2: a lane decides the
//     person's path and the path is fixed when they enter. Editing a lane
//     changes the *next* arrival, never somebody already in flight — which
//     is exactly the class of bug the audit found, where reading the rule
//     live stranded people in states the new rule doesn't have.
//   - **the facts are not derived and not derived from each other.** Each
//     is written by exactly one function. The stage is computed from these
//     plus the path (§4), never stored, so it cannot disagree with itself.
//
// Nothing here is a Member. `admittedMemberId` is the only pointer to one,
// and it is null until the single admission function (§6) runs.

export const admissionArrivalRoute = pgEnum("admission_arrival_route", ["invite", "application"]);
export const ADMISSION_ARRIVAL_ROUTES = ["invite", "application"] as const;
export type AdmissionArrivalRoute = (typeof ADMISSION_ARRIVAL_ROUTES)[number];

// How an arrival came to be admitted, for the roster-import bypass (§6).
// The import stays an administrator's bypass and records an arrival like
// any other so the history is complete and welcome behaviour is identical
// — it just did not walk the funnel to get here.
export const admissionOrigin = pgEnum("admission_origin", ["funnel", "import"]);
export const ADMISSION_ORIGINS = ["funnel", "import"] as const;
export type AdmissionOrigin = (typeof ADMISSION_ORIGINS)[number];

export const admission = pgTable(
  "admission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    cycleId: uuid("cycle_id").references(() => cycle.id),

    // Identity before membership: email and name as given, which are not
    // necessarily the member's eventual profile values and must not be
    // read back out of a Member that does not exist yet.
    email: text("email").notNull(),
    name: text("name").notNull(),

    // The lane, and the lane's path copied below. The id is kept so the
    // settings screen can say which lane this person is on; the snapshot
    // is what the funnel obeys.
    laneId: uuid("lane_id")
      .notNull()
      .references(() => admissionLane.id),

    route: admissionArrivalRoute("route").notNull(),
    origin: admissionOrigin("origin").notNull().default("funnel"),

    // The two things that can have created this arrival. Both are
    // nullable because either can be absent — an invitee who never sends
    // an application, a public applicant who was pre-paired — and the
    // *arrival* is the thing both now point at, rather than every
    // downstream table choosing "a form response *or* an invite".
    inviteId: uuid("invite_id"),
    formResponseId: uuid("form_response_id").references(() => formResponse.id),

    // The path, fixed at entry. Mirrors the lane's own fields rather than
    // storing a hash or a lane version: the point is to be readable and
    // to survive the lane being edited or archived afterwards.
    requiredVerification: admissionVerification("required_verification").notNull().default("none"),
    requiredApplication: boolean("required_application").notNull().default(true),
    requiredInterview: boolean("required_interview").notNull().default(true),
    // Derived from the two above (a report needs an application or an
    // interview to be about) but stored, because the snapshot has to be
    // self-contained: reading it back must not require re-deriving from
    // fields that could themselves be edited.
    requiredEvaluation: boolean("required_evaluation").notNull().default(true),
    reportsNeeded: integer("reports_needed"),
    supportShortcutCount: integer("support_shortcut_count"),

    // The person's own link (§4). Token, not member id — they have no
    // account, and this is the whole of their relationship with the
    // process until admission.
    token: text("token").notNull(),

    // Facts. Each written by exactly one function; see §4. Timestamps
    // rather than booleans because "when" is the question every screen
    // asks ("how long have they sat there"), and a boolean has no answer.
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
    checkPassedAt: timestamp("check_passed_at", { withTimezone: true }),
    applicationSubmittedAt: timestamp("application_submitted_at", { withTimezone: true }),
    interviewScheduledAt: timestamp("interview_scheduled_at", { withTimezone: true }),
    interviewHeldAt: timestamp("interview_held_at", { withTimezone: true }),
    // Evaluation needs no timestamp of its own — it is a count of the
    // evaluations table, and §4 forbids keeping a second opinion of it.
    decisionRecordedAt: timestamp("decision_recorded_at", { withTimezone: true }),
    // Supports received, and whether the shortcut was reached. The count
    // is read off joining_support rather than stored; what is stored is
    // *that the shortcut fired*, because that is a one-way fact with no
    // other witness.
    supportShortcutReachedAt: timestamp("support_shortcut_reached_at", { withTimezone: true }),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    admittedMemberId: uuid("admitted_member_id"),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // §6: capacity is checked at admission, so an approved arrival that
    // finds the event full waits here rather than being declined. A stage
    // docs/spec.md already names and the pipeline has never computed.
    waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The person's own link is the only credential they have, so it is the
    // only thing here that must be unique. Everything else is either an
    // id we generated or a nullable pointer that may legitimately be null.
    uniqueIndex("admission_token_idx").on(t.token),
    // One person, one arrival. A second one would mean two lanes could
    // claim the same person and the derived stage could disagree with
    // itself — the exact shape §1 principle 5 exists to prevent. Scoped by
    // community because the same address can legitimately apply to two
    // communities.
    uniqueIndex("admission_community_email_unique").on(t.communityId, t.email),
  ],
);