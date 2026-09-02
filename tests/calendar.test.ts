import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assembly, community, task } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { claimTask, createTaskMilestone } from "@/lib/tasks";
import { createCalendarEvent, acceptCalendarEventInvite } from "@/lib/calendar-events";
import { createProfileQuestion, answerProfileQuestion } from "@/lib/profile-questions";
import { createAssembly } from "@/lib/assemblies";
import { createPoll, submitAvailability, confirmSlot } from "@/lib/scheduling-polls";
import { createEventProposal, confirmEventProposalSlot, declineEventProposal, publishEventSchedule } from "@/lib/event-scheduling";
import { updateCommunity } from "@/lib/settings";
import { getCalendarView } from "@/lib/calendar";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

function slot(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

describe("getCalendarView", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is empty for a fresh community with no dated state", async () => {
    const { alice } = await createFixtures();
    const view = await getCalendarView(alice);
    expect(view).toEqual({ currentCycle: null, entries: [] });
  });

  it("includes the current cycle's resolved phase boundaries", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: "2027-02-01", endDate: "2027-03-01" }],
    });

    const view = await getCalendarView(alice);
    expect(view.currentCycle).toEqual({ id: cyc.id, name: "Season" });
    expect(view.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2027-02-01", kind: "phase_start", label: "Build starts" }),
        expect.objectContaining({ date: "2027-03-01", kind: "phase_end", label: "Build ends" }),
      ]),
    );
  });

  it("includes a confirmed milestone on a held task, not a pending one on someone else's", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id, { cycleId: cyc.id });
    await claimTask(alice, t.id);
    const m = await createTaskMilestone(alice, t.id, {
      label: "Order arrives",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 10 },
    });

    const view = await getCalendarView(alice);
    expect(view.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: m.resolvedDate, kind: "milestone", label: `Order arrives — ${t.title}` }),
      ]),
    );
    expect(await getCalendarView(bob)).toEqual({ currentCycle: view.currentCycle, entries: [] });
  });

  it("includes an event once accepted, distinct from a merely-invited one", async () => {
    const { alice, bob } = await createFixtures();
    const event = await createCalendarEvent(alice, {
      title: "Site walkthrough",
      date: { type: "absolute", date: "2027-05-01" },
      shareTarget: "community",
    });
    await acceptCalendarEventInvite(bob, event.id);

    const view = await getCalendarView(bob);
    expect(view.entries).toContainEqual(
      expect.objectContaining({ date: "2027-05-01", kind: "calendar_event", label: "Site walkthrough" }),
    );
  });

  it("includes the next input-round cutoff", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const cutoff = new Date("2027-06-01T00:00:00Z");
    await db.update(community).set({ nextInputRoundCutoffAt: cutoff }).where(eq(community.id, testCommunity.id));

    const view = await getCalendarView(alice);
    expect(view.entries).toContainEqual(
      expect.objectContaining({ date: "2027-06-01", kind: "input_round_cutoff" }),
    );
  });

  it("includes an open Assembly's three windows, excludes a closed one", async () => {
    const { alice } = await createFixtures();
    await createAssembly(alice, {
      title: "Open decision",
      agendaMinutes: 60,
      noticeMinutes: 60,
      votingMinutes: 60,
    });
    const closed = await createAssembly(alice, {
      title: "Old decision",
      agendaMinutes: 0,
      noticeMinutes: 0,
      votingMinutes: 1,
    });
    await db
      .update(assembly)
      .set({
        agendaEndsAt: new Date(Date.now() - 3 * 86400000),
        noticeEndsAt: new Date(Date.now() - 2 * 86400000),
        votingEndsAt: new Date(Date.now() - 86400000),
      })
      .where(eq(assembly.id, closed.id));

    const view = await getCalendarView(alice);
    const labels = view.entries.filter((e) => e.kind.startsWith("assembly_")).map((e) => e.label);
    expect(labels.some((l) => l.startsWith("Open decision"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Old decision"))).toBe(false);
  });

  it("includes only a resolved scheduling poll's confirmed slot, not an open one", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const resolved = await createPoll(alice, {
      branchId: testBranch.id,
      title: "Resolved call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });
    const s1 = slot(24);
    await submitAvailability(alice, resolved.id, { slots: [s1] });
    await confirmSlot(alice, resolved.id, { slot: s1 });

    await createPoll(alice, {
      branchId: testBranch.id,
      title: "Still open",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
    });

    const view = await getCalendarView(alice);
    const pollEntries = view.entries.filter((e) => e.kind === "poll_confirmed");
    expect(pollEntries).toHaveLength(1);
    expect(pollEntries[0].label).toBe("Resolved call");
    expect(pollEntries[0].date).toBe(s1.slice(0, 10));
  });

  it("includes only a confirmed and published event-scheduling proposal", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
    const [ownerTask] = await db
      .insert(task)
      .values({
        communityId: alice.communityId,
        branchId: testBranch.id,
        title: "Scheduling owner",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        createdBy: alice.id,
      })
      .returning();
    await claimTask(alice, ownerTask.id);
    await updateCommunity(alice, { eventSchedulingOwnerTaskId: ownerTask.id });

    const confirmed = await createEventProposal(bob, {
      host: "Bob",
      title: "Fire circle",
      durationMinutes: 60,
      preferredSlots: [{ startsAt: slot(24), endsAt: slot(25) }],
    });
    await confirmEventProposalSlot(alice, confirmed.id, { startsAt: slot(24), endsAt: slot(25) });
    const declined = await createEventProposal(bob, {
      host: "Bob",
      title: "Declined session",
      durationMinutes: 60,
      preferredSlots: [{ startsAt: slot(48), endsAt: slot(49) }],
    });
    await declineEventProposal(alice, declined.id);
    await publishEventSchedule(alice);

    const view = await getCalendarView(alice);
    const eventEntries = view.entries.filter((e) => e.kind === "event_confirmed");
    expect(eventEntries.map((e) => e.label)).toEqual(["Fire circle"]);
  });

  it("surfaces the actor's own opted-in birthday as its next yearly occurrence", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, { label: "Birthday", responseType: "date", scope: "once_ever" });
    // A birthday already passed this year — should roll to next year.
    const pastMonthDay = new Date(Date.now() - 400 * 86400000).toISOString().slice(5, 10);
    await answerProfileQuestion(alice, q.id, { status: "answered", value: `1990-${pastMonthDay}` });

    const view = await getCalendarView(alice);
    const birthday = view.entries.find((e) => e.kind === "birthday");
    expect(birthday).toBeDefined();
    expect(birthday!.date.slice(5, 10)).toBe(pastMonthDay);
    expect(birthday!.date >= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("sorts every entry by date ascending regardless of source order", async () => {
    const { alice } = await createFixtures();
    await createCalendarEvent(alice, {
      title: "Later",
      date: { type: "absolute", date: "2027-08-01" },
      shareTarget: "personal",
    });
    await createCalendarEvent(alice, {
      title: "Earlier",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "personal",
    });

    const view = await getCalendarView(alice);
    const dates = view.entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
  });
});
