import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, task } from "@/db/schema";
import {
  addAgendaItem,
  confirmSlot,
  createPoll,
  generateIcs,
  getConfirmedAttendees,
  getMyAvailability,
  getPollAggregate,
  getSummary,
  listAgendaItems,
  listSummaryReads,
  markSummaryRead,
  publishSummary,
  recordAttendance,
  saveSummary,
  submitAvailability,
} from "@/lib/scheduling-polls";
import { updateBranch } from "@/lib/settings/branches";
import { updateCommunity } from "@/lib/settings/community";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

function slot(dateIso: string) {
  return new Date(dateIso).toISOString();
}

describe("createPoll", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a poll and auto-creates the facilitate/summary tasks", async () => {
    const { alice, branch: testBranch } = await createFixtures();

    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Branch call",
      resolutionMode: "max_attendance",
      minAttendance: 2,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-03",
    });
    expect(poll.organizedBy).toBe(alice.id);

    const sourceTasks = await db.select().from(task).where(eq(task.sourcePollId, poll.id));
    expect(sourceTasks).toHaveLength(2);
    expect(sourceTasks.map((t) => t.sourcePollRole).sort()).toEqual(["facilitate", "summary"]);
    expect(sourceTasks.every((t) => t.branchId === testBranch.id)).toBe(true);
  });

  it("cascades call defaults: explicit input wins, then branch, then community", async () => {
    const { alice, branch: testBranch } = await createFixtures();

    await updateCommunity(alice, { defaultCallHasAgenda: true, defaultCallNeedsSummary: true });
    const communityFallback = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Uses community fallback",
      resolutionMode: "max_attendance",
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    expect(communityFallback.hasAgenda).toBe(true);
    expect(communityFallback.needsSummary).toBe(true);
    expect(communityFallback.requireRead).toBe(false);

    await updateBranch(alice, testBranch.id, { defaultCallHasAgenda: false });
    const branchOverride = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Branch overrides community",
      resolutionMode: "max_attendance",
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    expect(branchOverride.hasAgenda).toBe(false); // branch's explicit false wins over community's true
    expect(branchOverride.needsSummary).toBe(true); // branch never set this, falls through to community

    const explicitOverride = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Explicit input wins over everything",
      resolutionMode: "max_attendance",
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
      hasAgenda: true,
    });
    expect(explicitOverride.hasAgenda).toBe(true);
  });

  it("rejects an unknown branch", async () => {
    const { alice } = await createFixtures();
    await expect(
      createPoll(alice, {
        branchId: "00000000-0000-0000-0000-000000000000",
        title: "Nope",
        resolutionMode: "max_attendance",
        rangeStart: "2027-01-01",
        rangeEnd: "2027-01-02",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("availability + aggregate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function makePoll(actor: Parameters<typeof createPoll>[0], testBranch: { id: string }, overrides = {}) {
    return createPoll(actor, {
      branchId: testBranch.id,
      title: "Branch call",
      resolutionMode: "max_attendance",
      minAttendance: 2,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
      ...overrides,
    });
  }

  it("upserts a member's own submission and returns it via getMyAvailability", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const poll = await makePoll(alice, testBranch);
    const s1 = slot("2027-01-01T09:00:00Z");
    const s2 = slot("2027-01-01T09:30:00Z");

    await submitAvailability(alice, poll.id, { slots: [s1] });
    expect(await getMyAvailability(alice, poll.id)).toEqual([s1]);

    await submitAvailability(alice, poll.id, { slots: [s1, s2] });
    expect(await getMyAvailability(alice, poll.id)).toEqual([s1, s2]);
  });

  it("never exposes raw per-member submissions from the aggregate, only count + qualifies", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await makePoll(alice, testBranch, { minAttendance: 2 });
    const s1 = slot("2027-01-01T09:00:00Z");

    await submitAvailability(alice, poll.id, { slots: [s1] });
    await submitAvailability(bob, poll.id, { slots: [s1] });

    const { slots, submittedCount } = await getPollAggregate(alice, poll.id);
    expect(submittedCount).toBe(2);
    expect(slots).toHaveLength(1);
    expect(Object.keys(slots[0]).sort()).toEqual(["count", "qualifies", "slot"]);
    expect(slots[0].count).toBe(2);
    expect(slots[0].qualifies).toBe(true);
  });

  it("max_attendance: a slot only qualifies once it clears the threshold", async () => {
    const { alice, bob, community: testCommunity, branch: testBranch } = await createFixtures();
    const carol = (await db.insert(member).values({
      communityId: testCommunity.id,
      name: "Carol",
    }).returning())[0];
    const poll = await makePoll(alice, testBranch, { minAttendance: 3 });
    const s1 = slot("2027-01-01T09:00:00Z");

    await submitAvailability(alice, poll.id, { slots: [s1] });
    await submitAvailability(bob, poll.id, { slots: [s1] });
    expect((await getPollAggregate(alice, poll.id)).slots[0].qualifies).toBe(false);

    await submitAvailability(carol, poll.id, { slots: [s1] });
    expect((await getPollAggregate(alice, poll.id)).slots[0].qualifies).toBe(true);
  });

  it("must_overlap: only qualifies when every required participant covers the slot", async () => {
    const { alice, bob, community: testCommunity, branch: testBranch } = await createFixtures();
    const carol = (await db.insert(member).values({
      communityId: testCommunity.id,
      name: "Carol",
    }).returning())[0];
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Intro call",
      resolutionMode: "must_overlap",
      requiredParticipantIds: [bob.id, carol.id],
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot("2027-01-01T09:00:00Z");

    await submitAvailability(bob, poll.id, { slots: [s1] });
    // alice's own submission is irrelevant — she isn't required.
    await submitAvailability(alice, poll.id, { slots: [s1] });
    expect((await getPollAggregate(alice, poll.id)).slots[0].qualifies).toBe(false);

    await submitAvailability(carol, poll.id, { slots: [s1] });
    expect((await getPollAggregate(alice, poll.id)).slots[0].qualifies).toBe(true);
  });

  it("rejects submitting availability once a slot is confirmed", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const poll = await makePoll(alice, testBranch, { minAttendance: 1 });
    const s1 = slot("2027-01-01T09:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });
    await confirmSlot(alice, poll.id, { slot: s1 });

    await expect(submitAvailability(alice, poll.id, { slots: [s1] })).rejects.toThrow(ConflictError);
  });
});

describe("confirmSlot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-organizer", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot("2027-01-01T09:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });

    await expect(confirmSlot(bob, poll.id, { slot: s1 })).rejects.toThrow(ForbiddenError);
  });

  it("rejects a slot that doesn't qualify", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 5,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot("2027-01-01T09:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });

    await expect(confirmSlot(alice, poll.id, { slot: s1 })).rejects.toThrow(ConflictError);
  });

  it("confirms a qualifying slot once, rejects a second confirmation, and updates the source tasks' titles", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Branch call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot("2027-01-01T09:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });

    const confirmed = await confirmSlot(alice, poll.id, { slot: s1 });
    expect(confirmed.confirmedSlotStart?.toISOString()).toBe(s1);
    expect(confirmed.confirmedBy).toBe(alice.id);

    await expect(confirmSlot(alice, poll.id, { slot: s1 })).rejects.toThrow(ConflictError);

    const sourceTasks = await db.select().from(task).where(eq(task.sourcePollId, poll.id));
    const facilitateTask = sourceTasks.find((t) => t.sourcePollRole === "facilitate")!;
    const summaryTask = sourceTasks.find((t) => t.sourcePollRole === "summary")!;
    expect(facilitateTask.title).toContain("Branch call");
    expect(facilitateTask.title).not.toBe(`Facilitate "Branch call"`);
    expect(summaryTask.title).toContain("Branch call");
    expect(summaryTask.title).not.toBe(`Take notes & publish the summary for "Branch call"`);
  });

  it("getConfirmedAttendees is empty before confirmation and lists only the covering members after", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot("2027-01-01T09:00:00Z");
    const s2 = slot("2027-01-01T10:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });
    await submitAvailability(bob, poll.id, { slots: [s2] });

    expect(await getConfirmedAttendees(alice, poll.id)).toEqual([]);

    await confirmSlot(alice, poll.id, { slot: s1 });
    const attendees = await getConfirmedAttendees(alice, poll.id);
    expect(attendees.map((m) => m.id)).toEqual([alice.id]);
  });
});

describe("generateIcs", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("throws before a slot is confirmed, produces a real VEVENT after", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Branch call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    expect(() => generateIcs(poll)).toThrow(ConflictError);

    const s1 = slot("2027-01-01T09:00:00Z");
    await submitAvailability(alice, poll.id, { slots: [s1] });
    const confirmed = await confirmSlot(alice, poll.id, { slot: s1 });

    const ics = generateIcs(confirmed);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Branch call");
    expect(ics).toContain("DTSTART:20270101T090000Z");
    expect(ics).toContain("DTEND:20270101T093000Z");
  });
});

describe("agenda items", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds and lists agenda items, tenant-scoped", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });

    await addAgendaItem(alice, poll.id, { text: "What's the budget look like?" });
    const items = await listAgendaItems(alice, poll.id);
    expect(items).toHaveLength(1);

    await expect(addAgendaItem(strangerAlice, poll.id, { text: "Hijack" })).rejects.toThrow(NotFoundError);
  });
});

describe("call summary + read tracking", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("saves a draft, rejects publishing with none, publishes, and gates read-marking on publication", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });

    await expect(publishSummary(alice, poll.id)).rejects.toThrow(NotFoundError);

    const draft = await saveSummary(alice, poll.id, { body: "We discussed X." });
    expect(draft.publishedAt).toBeNull();

    const summary = await getSummary(alice, poll.id);
    await expect(markSummaryRead(bob, summary!.id)).rejects.toThrow(ConflictError);

    const published = await publishSummary(alice, poll.id);
    expect(published.publishedAt).not.toBeNull();

    await markSummaryRead(bob, summary!.id);
    const reads = await listSummaryReads(alice, summary!.id);
    expect(reads.map((r) => r.memberId)).toEqual([bob.id]);

    // Idempotent — reading twice doesn't create a second row.
    await markSummaryRead(bob, summary!.id);
    expect((await listSummaryReads(alice, summary!.id)).length).toBe(1);
  });
});

describe("attendance", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects recording attendance for a member who never submitted availability", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });

    await expect(recordAttendance(alice, poll.id, { memberId: bob.id, attended: true })).rejects.toThrow(
      ConflictError,
    );
  });

  it("records and upserts attendance for a member who did submit", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const poll = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    await submitAvailability(bob, poll.id, { slots: [slot("2027-01-01T09:00:00Z")] });

    const first = await recordAttendance(alice, poll.id, { memberId: bob.id, attended: true });
    expect(first.attended).toBe(true);

    const second = await recordAttendance(alice, poll.id, { memberId: bob.id, attended: false });
    expect(second.id).toBe(first.id);
    expect(second.attended).toBe(false);
  });
});

describe("settings: call defaults", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("updateCommunity accepts the three call-default booleans", async () => {
    const { alice } = await createFixtures();
    const updated = await updateCommunity(alice, {
      defaultCallHasAgenda: true,
      defaultCallNeedsSummary: true,
      defaultCallRequireRead: true,
    });
    expect(updated.defaultCallHasAgenda).toBe(true);
    expect(updated.defaultCallNeedsSummary).toBe(true);
    expect(updated.defaultCallRequireRead).toBe(true);
  });

  it("updateBranch accepts a real tri-state: unset (null), true, or false", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const [before] = await db.select().from(branch).where(eq(branch.id, testBranch.id));
    expect(before.defaultCallHasAgenda).toBeNull();

    const on = await updateBranch(alice, testBranch.id, { defaultCallHasAgenda: true });
    expect(on.defaultCallHasAgenda).toBe(true);

    const off = await updateBranch(alice, testBranch.id, { defaultCallHasAgenda: false });
    expect(off.defaultCallHasAgenda).toBe(false);

    const cleared = await updateBranch(alice, testBranch.id, { defaultCallHasAgenda: null });
    expect(cleared.defaultCallHasAgenda).toBeNull();
  });
});
