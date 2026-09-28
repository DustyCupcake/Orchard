import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";
import { objection } from "./recruitment";

// The shielded half of objection handling (docs/joining-admission-plan.md
// §2.6/§4.3). `objection.raisedBy` is at rest in the objection row but
// is only ever read by the mediation body; these two tables are what
// make that promise enforceable rather than merely intended:
//
//   objectionPartyExclusion — mirrors conflict_report_exclusion's
//     three routes exactly (reporter-excludes-at-creation, self-
//     recusal, peer-recusal) so the objector can take named people out
//     of even the mediation body's view. Differentiated only by who
//     added the row and when, not by a type enum — the same decision
//     conflict_report_exclusion already made.
//   objectionPartyConsent — the objector's own, revocable permission
//     for a *specific* named party to learn who they are. A consent is
//     the only way an identity ever leaves the shield, so it is its own
//     row rather than a boolean: it names who, and it can be withdrawn
//     later without touching the objection.
export const objectionPartyExclusion = pgTable("objection_party_exclusion", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectionId: uuid("objection_id")
    .notNull()
    .references(() => objection.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

// The shield is a list of exclusions plus a list of consents, and
// neither list is a reason to trust the other: an excluded member who
// has been consented-to is still excluded (the objector is the only
// one who can take someone *out* of the mediation body's view, and only
// they can *put* someone in on purpose). So the two are separate
// tables and the resolver applies them in that order — see
// src/lib/recruitment/mediation.ts's canMediationHolderSeeObjector.
export const objectionPartyConsent = pgTable("objection_party_consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectionId: uuid("objection_id")
    .notNull()
    .references(() => objection.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  // A one-line note the objector can leave for the person they consented
  // to tell — without it, "let them know" is a switch flipped at the
  // worst possible moment for the person on the receiving end.
  note: text("note"),
});
