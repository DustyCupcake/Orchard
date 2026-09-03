import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, cycle, member, memberIdentity, participation, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  isAnnouncementTaskHolder,
  listMyCoordinatedBranches,
  listMyHeldTasksForMessaging,
  listOutboundMessagesVisibleTo,
  requireAnnouncementTaskHolder,
  sendOutboundMessage,
} from "@/lib/messages";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

type Fixtures = Awaited<ReturnType<typeof createFixtures>>;

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
      title: "Some task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

// A "coordination"-tagged task, claimed by `actor` — the same shape
// isCoordinationHolder checks against everywhere else in this codebase.
async function makeCoordinationHolder(fixtures: Fixtures, actor: Fixtures["alice"]) {
  const coordTask = await insertTask(fixtures.community.id, fixtures.branch.id, actor.id, {
    title: "Coordination",
    tags: ["coordination"],
  });
  await claimTask(actor, coordTask.id);
  return coordTask;
}

async function giveEmail(memberId: string, email: string) {
  await db.insert(memberIdentity).values({ memberId, provider: "magic_link", loginEmail: email });
}

async function makeCurrentCycle(fixtures: Fixtures, overrides: Partial<typeof cycle.$inferInsert> = {}) {
  const [row] = await db
    .insert(cycle)
    .values({
      communityId: fixtures.community.id,
      name: "Current",
      status: "active",
      startedAt: new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

async function declareParticipation(
  cycleId: string,
  memberId: string,
  input: { status: "coming" | "maybe" | "not_coming" | "unknown"; arrivalDate?: string | null },
) {
  await db.insert(participation).values({
    cycleId,
    memberId,
    status: input.status,
    arrivalDate: input.arrivalDate ?? null,
  });
}

describe("isAnnouncementTaskHolder / requireAnnouncementTaskHolder", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false with no announcement task configured", async () => {
    const { alice } = await createFixtures();
    expect(await isAnnouncementTaskHolder(alice)).toBe(false);
    await expect(requireAnnouncementTaskHolder(alice)).rejects.toThrow(ForbiddenError);
  });

  it("is false for a non-holder once one is configured, true for the actual holder", async () => {
    const fixtures = await createFixtures();
    const announceTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, {
      title: "Announcements",
    });
    await updateCommunity(fixtures.alice, { announcementTaskId: announceTask.id });

    expect(await isAnnouncementTaskHolder(fixtures.bob)).toBe(false);
    await claimTask(fixtures.bob, announceTask.id);
    expect(await isAnnouncementTaskHolder(fixtures.bob)).toBe(true);
  });
});

describe("sendOutboundMessage: branch scope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-coordination-holder", async () => {
    const { alice, branch } = await createFixtures();
    await expect(
      sendOutboundMessage(alice, { scope: "branch", branchId: branch.id, subject: "Hi", body: "Hello" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a branch outside the actor's community", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherBranch] = await db.insert(branchTable).values({ communityId: otherCommunity.id, name: "Elsewhere" }).returning();

    await expect(
      sendOutboundMessage(fixtures.alice, {
        scope: "branch",
        branchId: otherBranch.id,
        subject: "Hi",
        body: "Hello",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lets a coordination holder message the branch roster, logging itself", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const rosterTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await claimTask(fixtures.bob, rosterTask.id);
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "branch",
      branchId: fixtures.branch.id,
      subject: "Fruit update",
      body: "Standup moved to 9am",
    });
    expect(created.scope).toBe("branch");
    expect(created.scopeRef).toEqual({ branchId: fixtures.branch.id });

    // sender (also on the coordination task, so also roster) sees it;
    // bob (roster via rosterTask) sees it; carol (holds nothing) doesn't.
    const forAlice = await listOutboundMessagesVisibleTo(fixtures.alice);
    const forBob = await listOutboundMessagesVisibleTo(fixtures.bob);
    const forCarol = await listOutboundMessagesVisibleTo(carol);
    expect(forAlice.map((m) => m.id)).toContain(created.id);
    expect(forBob.map((m) => m.id)).toContain(created.id);
    expect(forCarol.map((m) => m.id)).not.toContain(created.id);
  });
});

describe("sendOutboundMessage: task_holders scope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a member who doesn't hold the task", async () => {
    const { alice, branch, community: c } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
    await expect(
      sendOutboundMessage(alice, { scope: "task_holders", taskId: t.id, subject: "Hi", body: "Hello" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an unknown task", async () => {
    const { alice } = await createFixtures();
    await expect(
      sendOutboundMessage(alice, {
        scope: "task_holders",
        taskId: "00000000-0000-0000-0000-000000000000",
        subject: "Hi",
        body: "Hello",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lets a current holder message co-holders, not a shadow or an outsider", async () => {
    const fixtures = await createFixtures();
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 3 });
    await claimTask(fixtures.alice, t.id);
    await claimTask(fixtures.bob, t.id);
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "task_holders",
      taskId: t.id,
      subject: "Heads up",
      body: "Meeting at noon",
    });

    expect((await listOutboundMessagesVisibleTo(fixtures.bob)).map((m) => m.id)).toContain(created.id);
    expect((await listOutboundMessagesVisibleTo(carol)).map((m) => m.id)).not.toContain(created.id);
  });
});

describe("sendOutboundMessage: arrival_window scope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a member ineligible to initiate a cycle", async () => {
    const { alice } = await createFixtures(); // cyclesEnabled defaults false
    await expect(
      sendOutboundMessage(alice, { scope: "arrival_window", start: "2027-01-01", end: "2027-01-05", subject: "Hi", body: "Hello" }),
    ).rejects.toThrow();
  });

  it("rejects with no current cycle even once cycle-eligible", async () => {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { cyclesEnabled: true });
    await expect(
      sendOutboundMessage(fixtures.alice, {
        scope: "arrival_window",
        start: "2027-01-01",
        end: "2027-01-05",
        subject: "Hi",
        body: "Hello",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects an end date before the start date", async () => {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { cyclesEnabled: true });
    await makeCurrentCycle(fixtures);
    await expect(
      sendOutboundMessage(fixtures.alice, {
        scope: "arrival_window",
        start: "2027-01-05",
        end: "2027-01-01",
        subject: "Hi",
        body: "Hello",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("messages only coming/maybe members whose arrival date falls in the window, against the current cycle", async () => {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { cyclesEnabled: true });
    const currentCycle = await makeCurrentCycle(fixtures);
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();
    const [dave] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Dave" }).returning();
    const [eve] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Eve" }).returning();

    await declareParticipation(currentCycle.id, fixtures.bob.id, { status: "coming", arrivalDate: "2027-06-02" });
    await declareParticipation(currentCycle.id, carol.id, { status: "maybe", arrivalDate: "2027-06-04" });
    await declareParticipation(currentCycle.id, dave.id, { status: "coming", arrivalDate: "2027-06-10" }); // outside window
    await declareParticipation(currentCycle.id, eve.id, { status: "not_coming", arrivalDate: "2027-06-03" }); // declined

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "arrival_window",
      start: "2027-06-01",
      end: "2027-06-05",
      subject: "Welcome!",
      body: "See you soon",
    });
    expect(created.scopeRef).toEqual({ cycleId: currentCycle.id, start: "2027-06-01", end: "2027-06-05" });

    expect((await listOutboundMessagesVisibleTo(fixtures.bob)).map((m) => m.id)).toContain(created.id);
    const [carolRow] = await db.select().from(member).where(eq(member.id, carol.id));
    expect((await listOutboundMessagesVisibleTo(carolRow)).map((m) => m.id)).toContain(created.id);
    const [daveRow] = await db.select().from(member).where(eq(member.id, dave.id));
    expect((await listOutboundMessagesVisibleTo(daveRow)).map((m) => m.id)).not.toContain(created.id);
    const [eveRow] = await db.select().from(member).where(eq(member.id, eve.id));
    expect((await listOutboundMessagesVisibleTo(eveRow)).map((m) => m.id)).not.toContain(created.id);
  });

  it("a member with no declared arrival date at all is never targeted", async () => {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { cyclesEnabled: true });
    const currentCycle = await makeCurrentCycle(fixtures);
    await declareParticipation(currentCycle.id, fixtures.bob.id, { status: "coming", arrivalDate: null });

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "arrival_window",
      start: "2027-01-01",
      end: "2027-12-31",
      subject: "Hi",
      body: "Hello",
    });
    expect((await listOutboundMessagesVisibleTo(fixtures.bob)).map((m) => m.id)).not.toContain(created.id);
  });
});

describe("sendOutboundMessage: community scope (announcements)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-holder of the announcement task", async () => {
    const { alice } = await createFixtures();
    await expect(
      sendOutboundMessage(alice, { scope: "community", subject: "Hi", body: "Hello" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets the announcement-task holder message everyone, visible to everyone regardless of recipient status", async () => {
    const fixtures = await createFixtures();
    const announceTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, {
      title: "Announcements",
    });
    await updateCommunity(fixtures.alice, { announcementTaskId: announceTask.id });
    await claimTask(fixtures.alice, announceTask.id);
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "community",
      subject: "Season kickoff",
      body: "We're live",
    });
    expect(created.scope).toBe("community");

    expect((await listOutboundMessagesVisibleTo(fixtures.bob)).map((m) => m.id)).toContain(created.id);
    expect((await listOutboundMessagesVisibleTo(carol)).map((m) => m.id)).toContain(created.id);
  });
});

describe("delivery resilience", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("never throws when a recipient has opted out or has no email identity at all", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const rosterTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await claimTask(fixtures.bob, rosterTask.id);
    // bob opts out; no memberIdentity row exists for him at all either.
    await db.update(member).set({ emailNotificationsEnabled: false }).where(eq(member.id, fixtures.bob.id));

    await expect(
      sendOutboundMessage(fixtures.alice, {
        scope: "branch",
        branchId: fixtures.branch.id,
        subject: "Hi",
        body: "Hello",
      }),
    ).resolves.toBeTruthy();
  });

  it("still delivers (and doesn't throw) to a recipient who does have an email on file", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const rosterTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await claimTask(fixtures.bob, rosterTask.id);
    await giveEmail(fixtures.bob.id, "bob@example.com");

    const created = await sendOutboundMessage(fixtures.alice, {
      scope: "branch",
      branchId: fixtures.branch.id,
      subject: "Hi",
      body: "Hello",
    });
    expect(created.subject).toBe("Hi");
  });
});

describe("UI-gating helpers", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("listMyCoordinatedBranches reflects real coordination holdings", async () => {
    const fixtures = await createFixtures();
    expect(await listMyCoordinatedBranches(fixtures.alice)).toEqual([]);
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const branches = await listMyCoordinatedBranches(fixtures.alice);
    expect(branches.map((b) => b.id)).toEqual([fixtures.branch.id]);
  });

  it("listMyHeldTasksForMessaging lists only tasks the actor currently, really holds", async () => {
    const fixtures = await createFixtures();
    const held = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 2, title: "Held" });
    const unclaimed = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { title: "Unclaimed" });
    await claimTask(fixtures.alice, held.id);
    void unclaimed;

    const tasks = await listMyHeldTasksForMessaging(fixtures.alice);
    expect(tasks.map((t) => t.id)).toEqual([held.id]);
  });
});
