import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

export const taskNominationStatusEnum = pgEnum("task_nomination_status", [
  "pending",
  "accepted",
  "declined",
  "not_now",
  "expired",
]);

// "When a coordinator hands someone a task directly (rather than the
// person claiming it themselves)... a yes, no, or not-now are all
// fine — reply within [N days]... no response by the deadline
// auto-releases the task back to Unclaimed" — see docs/spec.md's Task
// assignment notification, and the Multi-slot section's "an existing
// owner can also nominate a specific person for an open slot... the
// same mechanism coordination uses, just triggered by a collaborator
// instead" (the two are one mechanism, not two).
//
// **Resolved interpretation, since spec's own wording is genuinely
// ambiguous about timing**: "hands someone a task directly" and
// "auto-releases... back to Unclaimed" read as describing a real,
// immediate claim made unilaterally by the nominator — not a pending
// invitation that only becomes a claim once accepted. This mirrors
// src/lib/tasks/waive.ts's waiveAndClaim exactly (a coordinator claims
// directly on someone else's behalf, no request/accept round-trip on
// the claiming side) — the difference here is the claim isn't
// overriding a Requirement (still checked normally, no waiver), and
// it comes with this courtesy confirm-or-auto-release window layered
// on top. `respondByDeadline`/`status` below track that window;
// `status = 'accepted'` changes nothing about the task itself (the
// assignment already exists) — it just closes the window early.
// `declined`/`not_now` and the scheduled `expired` case all release
// the same TaskAssignment row created at nomination time.
//
// No slotId — this codebase has no discrete per-slot identifiers
// anywhere else (multi-slot tasks are just capacity vs. TaskAssignment
// count), so "nominate for an open slot" is just "nominate while
// there's room," enforced the same way an ordinary claim already is.
export const taskNomination = pgTable("task_nomination", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  nominatedMemberId: uuid("nominated_member_id")
    .notNull()
    .references(() => member.id),
  nominatedBy: uuid("nominated_by")
    .notNull()
    .references(() => member.id),
  message: text("message"),
  status: taskNominationStatusEnum("status").notNull().default("pending"),
  respondByDeadline: timestamp("respond_by_deadline", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});
