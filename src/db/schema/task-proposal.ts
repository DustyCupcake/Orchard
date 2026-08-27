import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { task } from "./task";

export const taskProposalStatusEnum = pgEnum("task_proposal_status", [
  "pending",
  "activated",
  "declined",
]);

// The low-friction "just an idea" entry point (see docs/spec.md's
// "Proposing tasks") — deliberately not a Task row. Task's branch_id/
// effort/effort_magnitude are NOT NULL by design (every other phase
// relies on a real Task always having them), and a proposal doesn't
// have any of that yet. Activating one creates a real Task and this
// row just remembers where that Task came from.
export const taskProposal = pgTable("task_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => member.id),
  // "I'd like to claim this" — activates and assigns in one step.
  wantsToClaim: boolean("wants_to_claim").notNull().default(false),
  // "I'd suggest this person" — surfaces a fit without assigning it.
  suggestedMemberId: uuid("suggested_member_id").references(() => member.id),
  suggestedMemberNote: text("suggested_member_note"),
  status: taskProposalStatusEnum("status").notNull().default("pending"),
  declineReason: text("decline_reason"),
  activatedTaskId: uuid("activated_task_id").references(() => task.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
