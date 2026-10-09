import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

// The record this table exists to keep. docs/plans/archive/open-permissions-plan.md §9.1
// deferred it explicitly: "there is no audit mechanism for settings changes
// at all", and the reason given was that a faithful one has to cover every
// requireAdmins action behind /settings rather than just the cheap half
// (opened_by on open_permission_grant, which is already built). This is
// that piece of work.
//
// docs/spec.md is why it is member-readable rather than admin-only:
// settings changes are a collective decision reached through an Assembly
// whose tally is "always advisory, never auto-applied" (spec.md:1257), with
// a "foundational settings" change expected to reach quorum against the
// whole roster "before Admins act on it" (spec.md:430) — and a community
// cannot deliberate about a threshold it is not allowed to read.

// The settings entities whose fields can change. Named after the table each
// one edits rather than given a friendlier label, so a row is greppable back
// to the code that wrote it. bulk_member_import has no table of its own — it
// is the one settings action that creates rows in someone else's, so it is
// named as the action it is.
export const settingsChangeEntityEnum = pgEnum("settings_change_entity", [
  "community",
  "branch",
  "tier",
  "cycle_type",
  "trait_axis",
  "form",
  "profile_question",
  "consent_purpose",
  "sensitive_field_rule",
  "permission_grant",
  "open_permission_grant",
  "bulk_member_import",
]);

// One row per changed FIELD, not per save. A save that touches six columns is
// six rows sharing a timestamp, which is what makes "every change to
// onsiteModeEnabled" a plain indexed column match rather than a jsonb path
// query, and what lets the feed group a single save back together.
//
// Deliberately unbounded, like every other log in this schema
// (view_as_log, emergency_access_log, engagement_event, outbound_message).
// Settings changes are rare and admin-driven, so growth is not a concern
// worth a retention policy nobody has asked for. There is no index on
// (community_id, changed_at) either, and that is a choice rather than an
// oversight: this schema carries no non-unique index anywhere, and one
// community's settings history is small enough that a sequential scan is the
// cheaper plan on the 1-2GB VPS this targets (see CONTRIBUTING.md).
export const settingsChange = pgTable("settings_change", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored, where emergency_access_log and view_as_log derive it from the
  // member instead. Those are two-party rows read through the actor's own id;
  // this is a community-wide feed, so scoping the query by community is the
  // whole access question and deserves a column rather than a join.
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // The member id, never a name — the same rule as all 34 *By columns here.
  // Names are resolved in one batched query at read time, so a renamed member
  // does not leave a stale name written into history.
  actorId: uuid("actor_id")
    .notNull()
    .references(() => member.id),
  entity: settingsChangeEntityEnum("entity").notNull(),
  // Null wherever the thing changed has no single-row identity: the community
  // row itself is one row per deployment, and open_permission_grant is keyed
  // on (community_id, module_key) with no surrogate id.
  entityId: uuid("entity_id"),
  // A human-readable snapshot of the entity AT THE TIME OF THE CHANGE, and the
  // one thing here that is deliberately not resolved at read time. Branches,
  // tiers and profile questions get deleted, and the log outlives them, so
  // "Branch North was deleted" has to keep reading as Branch North a year
  // later — a name joined in at read time would read "—" forever. This is the
  // tombstone that open-permissions-plan.md §9.1 says the flag table alone
  // cannot answer.
  entityLabel: text("entity_label"),
  // created | updated | deleted | archived | unarchived | confirmed | rejected
  // | committed. Free text rather than an enum because it describes what a
  // caller did, and the entity enum above already carries the half of that
  // sentence worth constraining.
  action: text("action").notNull(),
  // The column as named in the schema (camelCase, as Drizzle has it), which is
  // what src/lib/settings/* calls it too.
  field: text("field").notNull(),
  // Old and new are both jsonb rather than text so an array or object field
  // (modulesEnabled, recruitmentDecisionRules) round-trips as itself instead
  // of being stringified into something a reader has to parse.
  //
  // **A null here does not say whether the value was null or unrecorded, and
  // this column is why that is not a problem.** Drizzle maps both SQL NULL and
  // a JSON `null` to JS `null` on read, so a reader cannot tell "the rejection
  // template was cleared" from "this value was deliberately not written" by
  // looking at new_value — verified, not assumed. So withheld values are
  // marked rather than inferred: valuesWithheld is true and both values are
  // SQL NULL, and it is false for a field genuinely set to null, which stores
  // a JSON null and renders as a cleared value. The alternative, letting the
  // UI hold its own list of which fields are sensitive, puts the policy in
  // two places that can drift.
  //
  // Only one field is withheld today — member_identity.loginEmail, whose
  // old/new pair would otherwise turn a member-readable log into a permanent
  // roster of every member's login address.
  valuesWithheld: boolean("values_withheld").notNull().default(false),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
