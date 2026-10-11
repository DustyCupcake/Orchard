import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { admission } from "./admission";
import { community } from "./community";
import { member } from "./member";

// docs/admission-flow.md §5 — one community check.
//
// There used to be two, built twice with different subjects, timers and
// consequences: a *wider discussion* window on an evaluated application, and a
// *consensus* window on an invite. They are one mechanism now: a time-boxed
// window on an **arrival**. Any member can raise a concern in it; a concern that
// stands holds the arrival and goes to the mediation body; a window that closes
// with no concern lets the arrival carry on.
//
// A check is a row, not a state on the arrival, because an arrival can have more
// than one over its life — the body can ask for more and, if the reports then
// lead to a wider discussion, there is a second window. At most one is open at a
// time (the partial unique index below).
//
// What is *stored* is what happened and when. Whether concerns are standing is
// read off the concerns, so there is no count to disagree with them (§4).

// Why the window opened. `entry`: the lane's verification is a community check, so
// it opened once the person had consented. `evaluation`: the reports led to a
// wider discussion.
export const communityCheckKind = pgEnum("community_check_kind", ["entry", "evaluation"]);
export const COMMUNITY_CHECK_KINDS = ["entry", "evaluation"] as const;
export type CommunityCheckKind = (typeof COMMUNITY_CHECK_KINDS)[number];

// What a window that closes with no concern does. Fixed when it opens, so a
// setting changed afterwards doesn't change what somebody already waiting is
// promised: `continue` lets the arrival go on to whatever its path has left
// (an entry check on a lane that is nothing else admits them), `admit` and
// `decline` are a wider discussion's two defaults (the decision form's "when the
// discussion ends with no concern").
export const communityCheckOnQuiet = pgEnum("community_check_on_quiet", ["continue", "admit", "decline"]);
export const COMMUNITY_CHECK_ON_QUIET = ["continue", "admit", "decline"] as const;
export type CommunityCheckOnQuiet = (typeof COMMUNITY_CHECK_ON_QUIET)[number];

// How a window ended. `quiet` is the deadline passing with nothing standing;
// `cleared` and `overruled` are mediation letting the arrival carry on, `upheld`
// is it declining them, `asked_for_more` is it sending them back to give more;
// `closed` is the window ending because the arrival did (admitted by another
// route, declined, withdrawn).
export const communityCheckEndedAs = pgEnum("community_check_ended_as", [
  "quiet",
  "cleared",
  "overruled",
  "upheld",
  "asked_for_more",
  "closed",
]);
export const COMMUNITY_CHECK_ENDED_AS = ["quiet", "cleared", "overruled", "upheld", "asked_for_more", "closed"] as const;
export type CommunityCheckEndedAs = (typeof COMMUNITY_CHECK_ENDED_AS)[number];

export const communityCheck = pgTable(
  "community_check",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    arrivalId: uuid("arrival_id")
      .notNull()
      .references(() => admission.id),
    kind: communityCheckKind("kind").notNull(),
    onQuiet: communityCheckOnQuiet("on_quiet").notNull(),
    // The window's length as it was when it opened (the community's setting is
    // `recruitment_wider_discussion_hours`), kept with its deadline so what a
    // person was told can be read back later.
    windowHours: integer("window_hours").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedAs: communityCheckEndedAs("ended_as"),
    // Who ended it, when a person did (the mediation member who settled the last
    // standing concern). Null for the clock and for an arrival that ended.
    endedById: uuid("ended_by_id").references(() => member.id),
    endedNote: text("ended_note"),
    // What "ask for more" asked for, kept so the person's page and the record can
    // say what the body wanted rather than only that it wanted something.
    askedApplication: boolean("asked_application").notNull().default(false),
    askedInterview: boolean("asked_interview").notNull().default(false),
  },
  (t) => [
    // One window at a time on an arrival. Ended ones stay as history.
    uniqueIndex("community_check_one_open_per_arrival")
      .on(t.arrivalId)
      .where(sql`${t.endedAt} is null`),
    index("community_check_community_open_idx").on(t.communityId, t.endedAt),
  ],
);

// A concern raised by a member inside a check window. `moot` is for the others
// standing when one decides the arrival: an upheld concern declines them and an
// ask for more sends them back, and either answers every concern raised so far —
// but it isn't mediation having judged each, so it says so rather than borrowing
// their word.
export const communityCheckConcernResolution = pgEnum("community_check_concern_resolution", [
  "standing",
  "cleared",
  "upheld",
  "overruled",
  "withdrawn",
  "asked_for_more",
  "moot",
]);
export const COMMUNITY_CHECK_CONCERN_RESOLUTIONS = [
  "standing",
  "cleared",
  "upheld",
  "overruled",
  "withdrawn",
  "asked_for_more",
  "moot",
] as const;
export type CommunityCheckConcernResolution = (typeof COMMUNITY_CHECK_CONCERN_RESOLUTIONS)[number];

// `raisedById` is at rest on the row and is only ever read by the mediation body
// and the person who raised it (src/lib/recruitment/mediation.ts's
// canSeeObjectorIdentity). Evaluators see the note and the date and nothing
// else, and the person and their inviter see nothing at all.
export const communityCheckConcern = pgTable(
  "community_check_concern",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    checkId: uuid("check_id")
      .notNull()
      .references(() => communityCheck.id),
    raisedById: uuid("raised_by_id")
      .notNull()
      .references(() => member.id),
    note: text("note").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    resolution: communityCheckConcernResolution("resolution").notNull().default("standing"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => member.id),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    index("community_check_concern_check_idx").on(t.checkId),
    index("community_check_concern_raised_by_idx").on(t.raisedById),
    index("community_check_concern_community_resolution_idx").on(t.communityId, t.resolution),
  ],
);

// The shield around whoever raised a concern (docs/admission-flow.md §5, "all of
// it"). Two tables and four actions, and none of them goes away with the merge:
//
//   exclusion — the objector takes named people out of even the mediation body's
//               view (at creation, by recusing themselves, or by recusing a
//               peer). Differentiated only by who added the row and when.
//   consent   — the objector's own, revocable permission for one named person to
//               learn who they are. The only way an identity leaves the shield,
//               so it is its own row: it names who, and can be withdrawn later.
//
// The two are not a reason to trust each other: an excluded member who has been
// consented to is still excluded.
export const communityCheckConcernExclusion = pgTable(
  "community_check_concern_exclusion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    addedById: uuid("added_by_id")
      .notNull()
      .references(() => member.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("community_check_concern_exclusion_concern_idx").on(t.concernId)],
);

export const communityCheckConcernConsent = pgTable(
  "community_check_concern_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // A one-line note the objector can leave for the person they consented to
    // tell — without it, "let them know" is a switch flipped at the worst
    // possible moment for the person on the receiving end.
    note: text("note"),
  },
  (t) => [index("community_check_concern_consent_concern_idx").on(t.concernId)],
);

// One mediation-body member's support for overruling a concern. The overrule is
// the one exception to "a concern stands" and it takes the community's threshold
// of the body *agreeing* (§5), so each holder's agreement has somewhere to live,
// with the reason they would, carried into the permanent record. Unique per
// (concern, member): support is a position, and changing your mind is an update.
export const communityCheckOverruleSupport = pgTable(
  "community_check_overrule_support",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    note: text("note").notNull(),
    supportedAt: timestamp("supported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("community_check_overrule_support_concern_member_unique").on(t.concernId, t.memberId)],
);
