import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

export const outboundMessageScopeEnum = pgEnum("outbound_message_scope", [
  "branch",
  "task_holders",
  "arrival_window",
  "community",
]);

// See docs/spec.md's "Outbound communications" (three tiers,
// increasingly gated — direct asks are Phase 51's own TaskNomination,
// this covers the other two) and docs/development-plan.md's Phase 53.
// A message never stores its recipient roster — "every send resolves
// its recipient set live at send time" per the dev-plan's own scope
// line — src/lib/messages.ts recomputes the audience from `scope`/
// `scopeRef` both to actually deliver and, later, to decide whether a
// given viewer is allowed to see this row in the sent-message log.
// `scopeRef` shape depends on `scope`:
//   branch          -> { branchId }
//   task_holders    -> { taskId }
//   arrival_window  -> { cycleId, start, end } (start/end are
//                       "YYYY-MM-DD" strings) — cycleId is captured at
//                       send time, not re-resolved as "whatever the
//                       current cycle happens to be" on a later read,
//                       so a message sent against one cycle's
//                       Participation doesn't silently start meaning a
//                       different cycle's once a new one starts.
//   community       -> {} (nothing to scope by)
export const outboundMessage = pgTable("outbound_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  sentBy: uuid("sent_by")
    .notNull()
    .references(() => member.id),
  scope: outboundMessageScopeEnum("scope").notNull(),
  scopeRef: jsonb("scope_ref").notNull().default({}),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
