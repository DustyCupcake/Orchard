import { boolean, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { admission } from "./admission";
import { community } from "./community";
import { member } from "./member";
import { task } from "./task";

// docs/plans/accompaniment-plan.md §3.1. The relation between a new member and the
// person accompanying them, kept as a row of its own. It used to be a side effect of a
// decision (`recruitment_decision.accompaniment_task_id`), which meant it could only be
// read through the decision, said nothing when a member was admitted by any other
// route, and had nowhere to hang what the member is told or chooses to share.
//
// The *task* ("Accompany <name>") stays the thing someone claims, with its ordinary
// lifecycle; this row says whose it is, when it started and when it ends. Who is
// accompanying is never stored here — it is whoever holds the task right now, read
// live, so a release or a hand-over can never leave this row disagreeing with the task.
export const accompaniment = pgTable(
  "accompaniment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    // The new member.
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    // Where it came from, when it came from the funnel.
    arrivalId: uuid("arrival_id").references(() => admission.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    // Computed when it starts from the community's "ends after" number, so changing the
    // setting never moves one already running.
    endsOn: timestamp("ends_on", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // The member said they would like someone else. The task went back to unclaimed and
    // the accompaniment stayed open; this is only so the next person to look can see why.
    askedForSomeoneElseAt: timestamp("asked_for_someone_else_at", { withTimezone: true }),
    // What the new member has chosen to let their accompanier see beyond the basics
    // (docs/plans/accompaniment-plan.md §4.2). Off until they say. Consent is to a person, not to a
    // role (§4.3), so these only count while the accompanier is the one they were set for
    // (`shared_with_member_id`); when the task changes hands they read as off again, nothing is
    // rewritten, and the member is asked afresh. A derived reset can't be missed by a code path that
    // forgot to do it.
    sharesAxes: boolean("shares_axes").notNull().default(false),
    sharesContribution: boolean("shares_contribution").notNull().default(false),
    // The third thing: profile answers the member has agreed to share with "my accompanier" (an
    // audience route on a question, see sensitive_field_access_rule). The switch is the person's
    // choice about this accompanier; the per-answer consent is about the answer. Both have to be yes.
    sharesAnswers: boolean("shares_answers").notNull().default(false),
    sharedWithMemberId: uuid("shared_with_member_id").references(() => member.id),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    // Whoever the member was last told is accompanying them, so a change of holder is
    // announced once and a quiet re-claim isn't announced twice. Compared with the
    // task's current holder by the job; never read as "who accompanies".
    announcedHolderId: uuid("announced_holder_id").references(() => member.id),
  },
  (t) => [
    // At most one open accompaniment per member: a second admission path can never make
    // a second task for the same person.
    uniqueIndex("accompaniment_one_open_per_member").on(t.memberId).where(sql`${t.endedAt} is null`),
    index("accompaniment_task_idx").on(t.taskId),
  ],
);
