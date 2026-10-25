import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { admission } from "./admission";
import { member } from "./member";

export const interviewCompanionStatusEnum = pgEnum("interview_companion_status", ["requested", "accepted", "declined"]);

// docs/plans/accompaniment-plan.md §6. The person who invited an applicant, asked (by the applicant,
// never by the team) whether they would like to be at the applicant's interview, to make it a nicer
// time for them. A companion is not an interviewer: they file no report, are not on the decision, and
// do not count toward the holders a slot needs. Their availability is preferred and never required,
// so one who never answers can't hold up anybody's interview.
//
// Keyed on the arrival, because that is who is being interviewed, and a shared interview between two
// paired people has each person's inviter asked separately.
export const interviewCompanion = pgTable(
  "interview_companion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arrivalId: uuid("arrival_id")
      .notNull()
      .references(() => admission.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    status: interviewCompanionStatusEnum("status").notNull().default("requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    // Declining is silent: no reason is asked for and nobody is notified; this is only so the prompt
    // stops appearing and the applicant's page can say, gently, that they can't make it this time.
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("interview_companion_arrival_member_unique").on(t.arrivalId, t.memberId)],
);
