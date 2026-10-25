import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, community, cycle, member, taskMilestone } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { claimTask, claimAsShadow } from "@/lib/tasks";
import { setTaskMilestoneDone } from "@/lib/tasks/milestones";
import { updateCommunity, updateCommunityInput } from "@/lib/settings";
import { listMyCheckInsDue, runAccompaniments } from "@/lib/accompaniment";
import { addDays } from "@/lib/dates";
import { checkInsSchema, planCheckIns } from "@/lib/accompaniment-check-ins";
import { ForbiddenError } from "@/lib/errors";

// docs/plans/accompaniment-plan.md step 3: check-ins are milestones on the accompaniment task, made
// from a short list the community edits, due on their date until the accompanier says they're done.

const today = () => new Date().toISOString().slice(0, 10);

describe("planning the check-ins", () => {
  const rows = [
    { label: "Say hello", anchor: "after_joining" as const, days: 3 },
    { label: "Before the event", anchor: "before_event" as const, days: 14 },
  ];

  it("counts forward from the day they join, and back from the event", () => {
    expect(planCheckIns(rows, { today: "2026-10-13", eventStart: "2026-12-01" })).toEqual([
      { label: "Say hello", date: "2026-10-16" },
      { label: "Before the event", date: "2026-11-17" },
    ]);
  });

  it("leaves out a before-the-event check-in with no event to count back from", () => {
    expect(planCheckIns(rows, { today: "2026-10-13", eventStart: null }).map((p) => p.label)).toEqual(["Say hello"]);
  });

  it("leaves out one whose date has already passed, and keeps one that is today", () => {
    expect(planCheckIns(rows, { today: "2026-10-13", eventStart: "2026-10-20" }).map((p) => p.label)).toEqual(["Say hello"]);
    expect(planCheckIns(rows, { today: "2026-10-13", eventStart: "2026-10-27" }).map((p) => p.label)).toEqual(["Say hello", "Before the event"]);
  });

  it("is happy with none at all", () => {
    expect(planCheckIns([], { today: "2026-10-13", eventStart: "2026-12-01" })).toEqual([]);
  });
});

describe("what a community may put in the list", () => {
  it("wants a name and a sane number of days, and not a great many rows", () => {
    expect(checkInsSchema.safeParse([{ label: "", anchor: "after_joining", days: 3 }]).success).toBe(false);
    expect(checkInsSchema.safeParse([{ label: "x", anchor: "after_joining", days: -1 }]).success).toBe(false);
    expect(checkInsSchema.safeParse([{ label: "x", anchor: "after_joining", days: 366 }]).success).toBe(false);
    expect(checkInsSchema.safeParse([{ label: "x", anchor: "someday", days: 3 }]).success).toBe(false);
    expect(checkInsSchema.safeParse(Array.from({ length: 13 }, () => ({ label: "x", anchor: "after_joining", days: 1 }))).success).toBe(false);
    expect(checkInsSchema.safeParse([]).success).toBe(true);
  });
});

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  return { ...fixtures, alice: holder, lane };
}

async function admit(setup: Awaited<ReturnType<typeof setUp>>, opts: { cycleId?: string | null; email?: string; name?: string } = {}) {
  const { arrival } = await createAdmissionArrival({
    communityId: setup.community.id,
    cycleId: opts.cycleId ?? null,
    email: opts.email ?? "dana@example.com",
    name: opts.name ?? "Dana",
    lane: setup.lane,
    route: "application",
  });
  const result = await admitArrival(arrival.id, { notify: false });
  const [acc] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, result.memberId!));
  const milestones = acc ? await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, acc.taskId)).orderBy(taskMilestone.absoluteDate) : [];
  return { memberId: result.memberId!, accompanimentRow: acc ?? null, milestones };
}

async function claimAs(memberId: string, taskId: string) {
  const [m] = await db.select().from(member).where(eq(member.id, memberId));
  await claimTask(m, taskId);
}

describe("making the check-ins with the accompaniment", () => {
  beforeEach(resetDatabase);

  it("uses the community's defaults: say hello at three days and how is it going at thirty, with no event to count back from", async () => {
    const setup = await setUp();
    const { milestones } = await admit(setup);
    expect(milestones.map((m) => [m.label, m.absoluteDate])).toEqual([
      ["Say hello", addDays(today(), 3)],
      ["How is it going?", addDays(today(), 30)],
    ]);
    // Ordinary milestones: confirmed, absolute, flagged as check-ins, and not done.
    expect(milestones.every((m) => m.checkIn && m.status === "confirmed" && m.dateType === "absolute" && m.completedAt === null)).toBe(true);
  });

  it("counts the third back from the event this person is joining, when it is far enough off", async () => {
    const setup = await setUp();
    const [event] = await db.insert(cycle).values({ communityId: setup.community.id, name: "Summer", startDate: addDays(today(), 60), endDate: addDays(today(), 66) }).returning();
    const { milestones } = await admit(setup, { cycleId: event.id });
    expect(milestones.map((m) => m.label)).toEqual(["Say hello", "How is it going?", "Before the event"]);
    expect(milestones.find((m) => m.label === "Before the event")!.absoluteDate).toBe(addDays(today(), 46));
  });

  it("finds the next open event when they weren't admitted for one, and ignores one that has started", async () => {
    const setup = await setUp();
    await db.insert(cycle).values({ communityId: setup.community.id, name: "Last year", startDate: addDays(today(), -200), endDate: addDays(today(), -194) });
    await db.insert(cycle).values({ communityId: setup.community.id, name: "Next", startDate: addDays(today(), 50), endDate: addDays(today(), 56) });
    const { milestones } = await admit(setup);
    expect(milestones.find((m) => m.label === "Before the event")!.absoluteDate).toBe(addDays(today(), 36));
  });

  it("leaves out the one before the event when that date has already gone", async () => {
    const setup = await setUp();
    const [soon] = await db.insert(cycle).values({ communityId: setup.community.id, name: "Soon", startDate: addDays(today(), 5), endDate: addDays(today(), 9) }).returning();
    const { milestones } = await admit(setup, { cycleId: soon.id });
    expect(milestones.map((m) => m.label)).toEqual(["Say hello", "How is it going?"]);
  });

  it("follows the list the community has, and makes none when it is empty", async () => {
    const setup = await setUp();
    await updateCommunity(setup.alice, { accompanimentCheckIns: [{ label: "A cuppa", anchor: "after_joining", days: 7 }] });
    const first = await admit(setup);
    expect(first.milestones.map((m) => [m.label, m.absoluteDate])).toEqual([["A cuppa", addDays(today(), 7)]]);

    await updateCommunity(setup.alice, { accompanimentCheckIns: [] });
    const second = await admit(setup, { email: "erin@example.com", name: "Erin" });
    expect(second.accompanimentRow).not.toBeNull();
    expect(second.milestones).toEqual([]);
  });

  it("refuses a list a person could not have meant, before it can reach the community", async () => {
    const setup = await setUp();
    // The settings action parses what arrives with this schema; a row with no name never gets to the community.
    expect(() => updateCommunityInput.parse({ accompanimentCheckIns: [{ label: "", anchor: "after_joining", days: 3 }] })).toThrow();
    const [row] = await db.select().from(community).where(eq(community.id, setup.community.id));
    expect(row.accompanimentCheckIns).toHaveLength(3);
  });
});

describe("what is due", () => {
  beforeEach(resetDatabase);

  async function dueSetUp() {
    const setup = await setUp();
    const made = await admit(setup);
    await claimAs(setup.bob.id, made.accompanimentRow!.taskId);
    const [bob] = await db.select().from(member).where(eq(member.id, setup.bob.id));
    const hello = made.milestones.find((m) => m.label === "Say hello")!;
    return { ...setup, bob, hello, made };
  }

  it("is nothing before the date, due on it, and overdue after it", async () => {
    const s = await dueSetUp();
    expect(await listMyCheckInsDue(s.bob)).toEqual([]);

    await db.update(taskMilestone).set({ absoluteDate: today() }).where(eq(taskMilestone.id, s.hello.id));
    expect(await listMyCheckInsDue(s.bob)).toMatchObject([{ label: "Say hello", newcomerName: "Dana", overdue: false }]);

    await db.update(taskMilestone).set({ absoluteDate: addDays(today(), -2) }).where(eq(taskMilestone.id, s.hello.id));
    expect(await listMyCheckInsDue(s.bob)).toMatchObject([{ label: "Say hello", overdue: true }]);
  });

  it("is only for whoever holds the task, and never for a shadow", async () => {
    const s = await dueSetUp();
    await db.update(taskMilestone).set({ absoluteDate: today() }).where(eq(taskMilestone.id, s.hello.id));
    expect(await listMyCheckInsDue(s.alice)).toEqual([]);
    await claimAsShadow(s.alice, s.made.accompanimentRow!.taskId);
    expect(await listMyCheckInsDue(s.alice)).toEqual([]);
  });

  it("goes when it is marked done, and comes back if it is put back", async () => {
    const s = await dueSetUp();
    await db.update(taskMilestone).set({ absoluteDate: today() }).where(eq(taskMilestone.id, s.hello.id));
    await setTaskMilestoneDone(s.bob, s.hello.id, true);
    expect(await listMyCheckInsDue(s.bob)).toEqual([]);
    const [done] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, s.hello.id));
    expect(done).toMatchObject({ completedBy: s.bob.id });
    expect(done.completedAt).not.toBeNull();

    await setTaskMilestoneDone(s.bob, s.hello.id, false);
    expect(await listMyCheckInsDue(s.bob)).toHaveLength(1);
  });

  it("can only be marked done by someone holding the task", async () => {
    const s = await dueSetUp();
    await expect(setTaskMilestoneDone(s.alice, s.hello.id, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is not due once the accompaniment is over, and a task nobody holds shows nothing to anyone", async () => {
    const s = await dueSetUp();
    await db.update(taskMilestone).set({ absoluteDate: today() }).where(and(eq(taskMilestone.taskId, s.made.accompanimentRow!.taskId)));
    expect(await listMyCheckInsDue(s.bob)).toHaveLength(2);
    await runAccompaniments(new Date(Date.now() + 100 * 86_400_000));
    expect(await listMyCheckInsDue(s.bob)).toEqual([]);
  });

  it("is not moved when somebody takes the task on late: it is simply due", async () => {
    const setup = await setUp();
    const made = await admit(setup);
    const hello = made.milestones.find((m) => m.label === "Say hello")!;
    await db.update(taskMilestone).set({ absoluteDate: addDays(today(), -5) }).where(eq(taskMilestone.id, hello.id));
    await claimAs(setup.bob.id, made.accompanimentRow!.taskId);
    const [bob] = await db.select().from(member).where(eq(member.id, setup.bob.id));
    expect(await listMyCheckInsDue(bob)).toMatchObject([{ label: "Say hello", date: addDays(today(), -5), overdue: true }]);
  });
});
