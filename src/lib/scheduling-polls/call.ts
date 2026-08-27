import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { callAgendaItem, callSummary, callSummaryRead, pollAttendance, schedulingEntry } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requirePollInCommunity } from "./crud";

type Member = typeof memberTable.$inferSelect;

export const addAgendaItemInput = z.object({ text: z.string().min(1) });
export type AddAgendaItemInput = z.infer<typeof addAgendaItemInput>;

// Open to any community member — see call.ts's schema comment on why
// there's no narrower "call audience" to gate this to yet.
export async function addAgendaItem(actor: Member, pollId: string, input: AddAgendaItemInput) {
  await requirePollInCommunity(actor, pollId);
  const [created] = await db
    .insert(callAgendaItem)
    .values({ pollId, addedBy: actor.id, text: input.text })
    .returning();
  return created;
}

export async function listAgendaItems(actor: Member, pollId: string) {
  await requirePollInCommunity(actor, pollId);
  return db.select().from(callAgendaItem).where(eq(callAgendaItem.pollId, pollId)).orderBy(callAgendaItem.createdAt);
}

export async function getSummary(actor: Member, pollId: string) {
  await requirePollInCommunity(actor, pollId);
  const [row] = await db.select().from(callSummary).where(eq(callSummary.pollId, pollId));
  return row ?? null;
}

export const saveSummaryInput = z.object({ body: z.string() });
export type SaveSummaryInput = z.infer<typeof saveSummaryInput>;

// Editable by any member, same open editing Task notes' wiki summary
// already uses (Phase 8) — a norm that whoever holds the summary task
// is the one who actually writes it, not a server-enforced gate.
// Upserts a single row per poll — no revision history, spec doesn't
// ask for one here.
export async function saveSummary(actor: Member, pollId: string, input: SaveSummaryInput) {
  await requirePollInCommunity(actor, pollId);
  const [existing] = await db.select().from(callSummary).where(eq(callSummary.pollId, pollId));

  if (existing) {
    const [updated] = await db
      .update(callSummary)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(callSummary.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(callSummary).values({ pollId, body: input.body }).returning();
  return created;
}

export async function publishSummary(actor: Member, pollId: string) {
  await requirePollInCommunity(actor, pollId);
  const [existing] = await db.select().from(callSummary).where(eq(callSummary.pollId, pollId));
  if (!existing) {
    throw new NotFoundError("No summary written yet");
  }
  const [updated] = await db
    .update(callSummary)
    .set({ publishedAt: new Date() })
    .where(eq(callSummary.id, existing.id))
    .returning();
  return updated;
}

// "An unread item ... until they have" — read-tracking only means
// anything once there's a real, published body to have read.
export async function markSummaryRead(actor: Member, summaryId: string) {
  const [summary] = await db.select().from(callSummary).where(eq(callSummary.id, summaryId));
  if (!summary) {
    throw new NotFoundError("Summary not found");
  }
  if (!summary.publishedAt) {
    throw new ConflictError("This summary hasn't been published yet");
  }

  const [existing] = await db
    .select()
    .from(callSummaryRead)
    .where(and(eq(callSummaryRead.summaryId, summaryId), eq(callSummaryRead.memberId, actor.id)));
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(callSummaryRead)
    .values({ summaryId, memberId: actor.id })
    .returning();
  return created;
}

export async function listSummaryReads(actor: Member, summaryId: string) {
  const [summary] = await db.select().from(callSummary).where(eq(callSummary.id, summaryId));
  if (!summary) {
    throw new NotFoundError("Summary not found");
  }
  await requirePollInCommunity(actor, summary.pollId);
  return db.select().from(callSummaryRead).where(eq(callSummaryRead.summaryId, summaryId));
}

export const recordAttendanceInput = z.object({
  memberId: z.string().uuid(),
  attended: z.boolean(),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceInput>;

// "Recorded after the fact by whoever ran the call — a simple mark
// against the expected audience." The expected audience here is
// whoever submitted availability for the poll — see call.ts's schema
// comment on why (no real Branch roster feature exists yet).
export async function recordAttendance(actor: Member, pollId: string, input: RecordAttendanceInput) {
  await requirePollInCommunity(actor, pollId);
  const [submitted] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, pollId), eq(schedulingEntry.memberId, input.memberId)));
  if (!submitted) {
    throw new ConflictError("That member never submitted availability for this poll");
  }

  const [existing] = await db
    .select()
    .from(pollAttendance)
    .where(and(eq(pollAttendance.pollId, pollId), eq(pollAttendance.memberId, input.memberId)));

  if (existing) {
    const [updated] = await db
      .update(pollAttendance)
      .set({ attended: input.attended, recordedBy: actor.id, recordedAt: new Date() })
      .where(eq(pollAttendance.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(pollAttendance)
    .values({ pollId, memberId: input.memberId, attended: input.attended, recordedBy: actor.id })
    .returning();
  return created;
}

export async function listAttendance(actor: Member, pollId: string) {
  await requirePollInCommunity(actor, pollId);
  return db.select().from(pollAttendance).where(eq(pollAttendance.pollId, pollId));
}
