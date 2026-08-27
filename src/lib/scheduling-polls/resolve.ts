import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, schedulingEntry, schedulingPoll, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError } from "../errors";
import { updateTask } from "../tasks/crud";
import { getPollAggregate } from "./availability";
import { requirePollInCommunity } from "./crud";

type Member = typeof memberTable.$inferSelect;

const SLOT_MS = 30 * 60_000;

export const confirmSlotInput = z.object({ slot: z.string().datetime() });
export type ConfirmSlotInput = z.infer<typeof confirmSlotInput>;

// Only the organizer confirms — spec says "whoever's organizing"
// throughout this section. Only a slot the aggregate actually
// qualifies (per the poll's own resolution mode) can be confirmed —
// the platform won't let an urgent-but-empty slot get locked in by
// mistake.
export async function confirmSlot(actor: Member, pollId: string, input: ConfirmSlotInput) {
  const poll = await requirePollInCommunity(actor, pollId);
  if (poll.organizedBy !== actor.id) {
    throw new ForbiddenError("Only this poll's organizer can confirm a slot");
  }
  if (poll.confirmedSlotStart) {
    throw new ConflictError("This poll has already resolved a slot");
  }

  const { slots } = await getPollAggregate(actor, pollId);
  const chosen = slots.find((s) => s.slot === input.slot);
  if (!chosen || !chosen.qualifies) {
    throw new ConflictError("That slot doesn't meet this poll's resolution criteria");
  }

  const start = new Date(input.slot);
  const end = new Date(start.getTime() + SLOT_MS);

  const [updated] = await db
    .update(schedulingPoll)
    .set({ confirmedSlotStart: start, confirmedSlotEnd: end, confirmedBy: actor.id, confirmedAt: new Date() })
    .where(eq(schedulingPoll.id, pollId))
    .returning();

  // "Facilitate [date]'s call" — the date's only known now.
  const whenLabel = start.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const sourceTasks = await db.select().from(task).where(eq(task.sourcePollId, pollId));
  for (const t of sourceTasks) {
    const title =
      t.sourcePollRole === "facilitate"
        ? `Facilitate ${whenLabel}'s call ("${poll.title}")`
        : `Take notes & publish the summary for ${whenLabel}'s call ("${poll.title}")`;
    await updateTask(actor, t.id, { title });
  }

  return updated;
}

// Only meaningful once a slot is confirmed — the members whose
// submission covered it. This is the one place raw per-member data
// becomes visible, and only for the confirmed slot specifically
// (needed for invites and as the attendance-recording checklist).
export async function getConfirmedAttendees(actor: Member, pollId: string) {
  const poll = await requirePollInCommunity(actor, pollId);
  if (!poll.confirmedSlotStart) {
    return [];
  }
  const slotIso = poll.confirmedSlotStart.toISOString();

  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, pollId));
  const attendeeIds = entries
    .filter((e) => (e.availableSlots as string[]).includes(slotIso))
    .map((e) => e.memberId);
  if (attendeeIds.length === 0) return [];

  const members = await db.select().from(member).where(eq(member.communityId, actor.communityId));
  const byId = new Map(members.map((m) => [m.id, m]));
  return attendeeIds.map((id) => byId.get(id)).filter((m): m is typeof member.$inferSelect => Boolean(m));
}

function icsEscape(text: string) {
  return text.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}

function icsTimestamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// A downloadable .ics file rather than an emailed invite — this
// codebase has no real outbound-broadcast-email layer yet (every
// other "notification" here — talk-to-coordinator pings, signals,
// input-round reminders — is likewise pull, something a member comes
// back to look at, not a push), so "calendar invites go out" is
// fulfilled the same way: a real, standards-shaped artifact anyone
// confirmed for the slot can pull down and add to their own calendar.
export function generateIcs(poll: typeof schedulingPoll.$inferSelect) {
  if (!poll.confirmedSlotStart || !poll.confirmedSlotEnd) {
    throw new ConflictError("This poll hasn't confirmed a slot yet");
  }
  const now = icsTimestamp(new Date());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchard//Scheduling Poll//EN",
    "BEGIN:VEVENT",
    `UID:${poll.id}@orchard`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsTimestamp(poll.confirmedSlotStart)}`,
    `DTEND:${icsTimestamp(poll.confirmedSlotEnd)}`,
    `SUMMARY:${icsEscape(poll.title)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
