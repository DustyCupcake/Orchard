import { boolean, date, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { task, taskEffortEnum } from "./task";

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
  // Everything below is optional, offered on /propose's own collapsed
  // "Add more, if you know it" section — a proposer's suggestion for
  // fields a real Task requires, not a commitment. All nullable, same
  // "doesn't have any of that yet" posture as the rest of this row;
  // activation still reviews and can freely override every one.
  suggestedBranchId: uuid("suggested_branch_id").references(() => branch.id),
  suggestedCycleId: uuid("suggested_cycle_id").references(() => cycle.id),
  suggestedEffort: taskEffortEnum("suggested_effort"),
  suggestedEffortMagnitude: jsonb("suggested_effort_magnitude"),
  suggestedTags: text("suggested_tags").array(),
  suggestedCapacity: integer("suggested_capacity"),
  suggestedCritical: boolean("suggested_critical"),
  suggestedDueDate: date("suggested_due_date"),
  // TraitAxis id -> value (-2..2), for every axis except "commitment
  // preference" (derived from suggestedEffort/Task.effort instead — see
  // src/lib/trait-axes.ts). Same posture as every other suggested*
  // field: optional, reviewed and freely overridable at activation.
  suggestedAxisValues: jsonb("suggested_axis_values"),
  status: taskProposalStatusEnum("status").notNull().default("pending"),
  declineReason: text("decline_reason"),
  activatedTaskId: uuid("activated_task_id").references(() => task.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
