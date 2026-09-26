import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";

// A community-defined set of fields with a stated purpose — shared
// infrastructure other modules lean on, the same way Requirement is,
// not a module a Community turns on independently. See docs/spec.md's
// "Forms".
export const form = pgTable("form", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  title: text("title").notNull(),
  description: text("description"),
  // Array of {key, label, responseType, options, required} plus the
  // field-shape flags (multiline, validation, allowOther, min/max/step)
  // — the exact same shape ProfileQuestion uses, per spec's "Forms made
  // of Questions? Partly." Both project into src/lib/field-shape.ts's
  // FieldShape, which is the one definition of how a question is
  // answered; this row and ProfileQuestion's only add what Form owns
  // (the key, the name/email role tags, mapsToProfileQuestionId) or what
  // ProfileQuestion owns (scope, required, deferral, due date). Kept as
  // jsonb rather than a child table: a Form's fields are opaque to the
  // platform and submitted together as one event, never individually
  // queried the way a Question row is.
  fields: jsonb("fields").notNull().default([]),
  allowAnonymous: boolean("allow_anonymous").notNull().default(false),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// One submission — "together, once, as a single validated event," the
// real behavioral line spec draws against Question (always
// independently optional to answer). submittedBy is null only when the
// form allows anonymous and the submitter opted into it on this
// specific response; submitting still requires being an authenticated
// member either way.
export const formResponse = pgTable("form_response", {
  id: uuid("id").primaryKey().defaultRandom(),
  formId: uuid("form_id")
    .notNull()
    .references(() => form.id),
  // The cycle this submission is about — docs/spec.md's `response.cycle_id`
  // (spec.md:867). Post-cycle feedback is the first consumer
  // (docs/cycle-scope-remediation-plan.md §4.3): a feedback_review task
  // placed in a cycle reviews that cycle's responses, a cycle-less one
  // reviews everything. Null = general feedback not tied to any one
  // cycle (or a community that runs no cycles at all).
  cycleId: uuid("cycle_id").references(() => cycle.id),
  submittedBy: uuid("submitted_by").references(() => member.id),
  values: jsonb("values").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
