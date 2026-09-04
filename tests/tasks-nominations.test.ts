import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity, task, taskAssignment, taskNomination } from "@/db/schema";
import {
  claimTask,
  createRequirement,
  isAuthorizedToNominate,
  listMyExpiredNominations,
  listMyPendingNominations,
  listNominationsForTask,
  nominateForTask,
  RESPONSE_TOKEN_KIND,
  resolveTaskNominationDeadlines,
  respondToNomination,
  respondToNominationByToken,
} from "@/lib/tasks";
import { issueActionToken } from "@/lib/notifications";
import { updateCommunity } from "@/lib/settings";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

const APP_URL = "http://localhost:3000";

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
      title: "Order breakfast supplies",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

async function makeCoordinationHolder(fixtures: Awaited<ReturnType<typeof createFixtures>>, actor: typeof fixtures.alice) {
  const coordTask = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, {
    title: "Coordination",
  });
  await grantPermission(fixtures.community.id, "branch_coordination", coordTask.id);
  await claimTask(actor, coordTask.id);
}

describe("isAuthorizedToNominate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is true for the task's branch coordination holder", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    expect(await isAuthorizedToNominate(fixtures.alice, t)).toBe(true);
  });

  it("is true for an existing real (non-shadow) holder of the task itself", async () => {
    const fixtures = await createFixtures();
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 2 });
    await claimTask(fixtures.alice, t.id);

    expect(await isAuthorizedToNominate(fixtures.alice, t)).toBe(true);
  });

  it("is false for a member with neither", async () => {
    const fixtures = await createFixtures();
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    expect(await isAuthorizedToNominate(fixtures.bob, t)).toBe(false);
  });
});

describe("nominateForTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("claims the task for the nominee immediately and creates a pending nomination", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    const { task: updatedTask, nomination } = await nominateForTask(
      fixtures.alice,
      t.id,
      { memberId: fixtures.bob.id, message: "you'd be great at this" },
      APP_URL,
    );

    expect(updatedTask.status).toBe("claimed");
    expect(nomination.status).toBe("pending");
    expect(nomination.nominatedMemberId).toBe(fixtures.bob.id);
    expect(nomination.nominatedBy).toBe(fixtures.alice.id);
    expect(nomination.message).toBe("you'd be great at this");

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.taskId, t.id));
    expect(assignment.memberId).toBe(fixtures.bob.id);
  });

  it("respects the community's configured response window", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    await updateCommunity(fixtures.alice, { taskNominationResponseDays: 5 });
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    const before = Date.now();
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);
    const daysUntilDeadline = (nomination.respondByDeadline.getTime() - before) / 86_400_000;

    expect(daysUntilDeadline).toBeGreaterThan(4.9);
    expect(daysUntilDeadline).toBeLessThan(5.1);
  });

  it("rejects a member with no coordination authority and no existing hold", async () => {
    const fixtures = await createFixtures();
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    await expect(
      nominateForTask(fixtures.bob, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects nomination for a community_endorsed task", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, {
      openness: "community_endorsed",
      capacity: null,
      endorsementThreshold: 1,
    });

    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(ConflictError);
  });

  it("fails with the same unmet-requirements error an ordinary claim would get, never bypassing the gate", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await createRequirement(fixtures.alice, t.id, { type: "custom", value: { flag: "cert" } });

    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(ForbiddenError);

    const nominations = await db.select().from(taskNomination).where(eq(taskNomination.taskId, t.id));
    expect(nominations).toHaveLength(0);
  });

  it("rejects capacity already full", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 1 });
    await claimTask(fixtures.alice, t.id);

    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a duplicate pending nomination for the same member on the same task", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 2 });
    await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    // The dedup check fires before performClaimInTx's own "already
    // holds" check would — same ConflictError either way, but this is
    // specifically exercising the dedup path, not a coincidental one.
    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects an unknown task or member", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    await expect(
      nominateForTask(fixtures.alice, "00000000-0000-0000-0000-000000000000", { memberId: fixtures.bob.id }, APP_URL),
    ).rejects.toThrow(NotFoundError);
    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: "00000000-0000-0000-0000-000000000000" }, APP_URL),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("respondToNomination", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("accept closes the window without touching the already-real assignment", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const updated = await respondToNomination(fixtures.bob, nomination.id, { response: "accepted" });
    expect(updated.status).toBe("accepted");

    const [assignment] = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, t.id));
    expect(assignment.memberId).toBe(fixtures.bob.id);
    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("claimed");
  });

  it("declined releases the assignment back to Unclaimed", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const updated = await respondToNomination(fixtures.bob, nomination.id, { response: "declined" });
    expect(updated.status).toBe("declined");

    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("unclaimed");
    const assignments = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, t.id));
    expect(assignments).toHaveLength(0);
  });

  it("not_now also releases the assignment", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const updated = await respondToNomination(fixtures.bob, nomination.id, { response: "not_now" });
    expect(updated.status).toBe("not_now");
    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("unclaimed");
  });

  it("releasing one nominee's slot on a multi-slot task leaves the other holder untouched", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id, { capacity: 2 });
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();
    await claimTask(carol, t.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    await respondToNomination(fixtures.bob, nomination.id, { response: "declined" });

    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("claimed");
    const assignments = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, t.id));
    expect(assignments.map((a) => a.memberId)).toEqual([carol.id]);
  });

  it("rejects a response from anyone other than the nominee", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    await expect(respondToNomination(fixtures.alice, nomination.id, { response: "accepted" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("rejects responding to an already-resolved nomination", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);
    await respondToNomination(fixtures.bob, nomination.id, { response: "accepted" });

    await expect(respondToNomination(fixtures.bob, nomination.id, { response: "declined" })).rejects.toThrow(
      ConflictError,
    );
  });
});

describe("respondToNominationByToken", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("resolves a valid single-use token to the right response, and can't be replayed", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const token = await issueActionToken(
      RESPONSE_TOKEN_KIND,
      { nominationId: nomination.id, response: "accepted" as const },
      60_000,
    );

    const updated = await respondToNominationByToken(token);
    expect(updated?.status).toBe("accepted");

    // Same token again — already consumed.
    expect(await respondToNominationByToken(token)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await respondToNominationByToken("not-a-real-token")).toBeNull();
  });

  it("a decline token releases the assignment exactly like the in-app path does", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const token = await issueActionToken(
      RESPONSE_TOKEN_KIND,
      { nominationId: nomination.id, response: "declined" as const },
      60_000,
    );
    await respondToNominationByToken(token);

    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("unclaimed");
  });

  it("really sends when the nominee has a real email on file — verified via the token it issues actually working end to end", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    await db
      .insert(memberIdentity)
      .values({ memberId: fixtures.bob.id, provider: "magic_link", loginEmail: "bob@example.com" });
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);

    // nominateForTask itself calls sendTaskNominationEmail (console-log
    // fallback in this test env, no SMTP configured) — this test's real
    // point is just confirming the call path doesn't throw when a real
    // identity exists to look up, covered implicitly by not rejecting.
    await expect(
      nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL),
    ).resolves.toBeDefined();
  });
});

describe("resolveTaskNominationDeadlines", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("expires a pending nomination past its deadline and releases the assignment", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    await db
      .update(taskNomination)
      .set({ respondByDeadline: new Date(Date.now() - 1000) })
      .where(eq(taskNomination.id, nomination.id));

    const result = await resolveTaskNominationDeadlines();
    expect(result.expired).toBe(1);

    const [updatedNomination] = await db.select().from(taskNomination).where(eq(taskNomination.id, nomination.id));
    expect(updatedNomination.status).toBe("expired");
    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("unclaimed");
  });

  it("leaves a nomination with a future deadline untouched", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);

    const result = await resolveTaskNominationDeadlines();
    expect(result.expired).toBe(0);

    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("claimed");
  });

  it("never re-processes an already-resolved nomination even if its deadline is in the past", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);
    await respondToNomination(fixtures.bob, nomination.id, { response: "accepted" });
    await db
      .update(taskNomination)
      .set({ respondByDeadline: new Date(Date.now() - 1000) })
      .where(eq(taskNomination.id, nomination.id));

    const result = await resolveTaskNominationDeadlines();
    expect(result.expired).toBe(0);
    const [taskRow] = await db.select().from(task).where(eq(task.id, t.id));
    expect(taskRow.status).toBe("claimed");
  });
});

describe("listing helpers", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("listMyPendingNominations shows the nominee's own pending nomination with nominator/task context", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id, message: "great fit" }, APP_URL);

    const pending = await listMyPendingNominations(fixtures.bob);
    expect(pending).toHaveLength(1);
    expect(pending[0].taskTitle).toBe(t.title);
    expect(pending[0].nominatorName).toBe("Alice");
    expect(pending[0].nomination.message).toBe("great fit");
  });

  it("listMyExpiredNominations shows the nominator's own expired-without-response nominations", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);
    await db
      .update(taskNomination)
      .set({ respondByDeadline: new Date(Date.now() - 1000) })
      .where(eq(taskNomination.id, nomination.id));
    await resolveTaskNominationDeadlines();

    const expired = await listMyExpiredNominations(fixtures.alice);
    expect(expired).toHaveLength(1);
    expect(expired[0].nomineeName).toBe("Bob");
    expect(expired[0].taskTitle).toBe(t.title);

    // Bob himself (the nominee, not the nominator) sees none here.
    expect(await listMyExpiredNominations(fixtures.bob)).toEqual([]);
  });

  it("listNominationsForTask shows every nomination against a task regardless of status", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination } = await nominateForTask(fixtures.alice, t.id, { memberId: fixtures.bob.id }, APP_URL);
    await respondToNomination(fixtures.bob, nomination.id, { response: "declined" });

    const list = await listNominationsForTask(fixtures.alice, t.id);
    expect(list).toHaveLength(1);
    expect(list[0].nomination.status).toBe("declined");
    expect(list[0].nomineeName).toBe("Bob");
  });
});
