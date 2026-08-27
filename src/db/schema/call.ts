import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { schedulingPoll } from "./scheduling-poll";
import { member } from "./member";

// "Anyone in the call's audience can add an item beforehand" — same
// low-friction, no-approval posting as Input round questions or an
// Assembly's agenda items. "The call's audience" isn't a defined
// roster anywhere in this schema yet (see Branch's emergent/explicit
// membership fork, still just a config flag with no real roster
// table), so this is open to any community member, same resolved
// interpretation Input rounds and Assemblies already made for their
// own open-posting mechanisms.
export const callAgendaItem = pgTable("call_agenda_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id")
    .notNull()
    .references(() => schedulingPoll.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "The summary task's output" — one per poll (enforced in
// src/lib/scheduling-polls/call.ts's upsert logic, not a DB unique
// constraint, matching this codebase's general preference for
// app-level invariants over heavier DB constraints). Updated in
// place, no revision history — spec doesn't ask for one here the way
// task wiki notes get one.
export const callSummary = pgTable("call_summary", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id")
    .notNull()
    .references(() => schedulingPoll.id),
  body: text("body").notNull().default(""),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A plain acknowledgment expected of a defined audience, not an
// opt-in response — a different kind of tracking than a Question's
// responses. Shaped generically (a member and a timestamp against one
// artifact) per spec's own note that it could extend to Announcements
// later.
export const callSummaryRead = pgTable("call_summary_read", {
  id: uuid("id").primaryKey().defaultRandom(),
  summaryId: uuid("summary_id")
    .notNull()
    .references(() => callSummary.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Recorded after the fact by whoever ran the call — a simple mark
// against the expected audience." No real Branch roster exists yet
// (see callAgendaItem's comment above), so "the expected audience"
// resolves to whoever submitted availability for the poll — the only
// real audience list this schema can produce without one.
export const pollAttendance = pgTable("poll_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id")
    .notNull()
    .references(() => schedulingPoll.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  attended: boolean("attended").notNull(),
  recordedBy: uuid("recorded_by")
    .notNull()
    .references(() => member.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
