import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, admission, community, member, memberIdentity, requirement, task, taskAssignment, taskComment, tier } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { claimTask, finishTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { askForSomeoneElse, ensureAccompaniment, getAccompaniedMemberId, getMyAccompaniment, runAccompaniments } from "@/lib/accompaniment";
import { ConflictError, NotFoundError } from "@/lib/errors";

// docs/plans/accompaniment-plan.md, step 1: a new member has someone to ask questions of, the
// relation is a row of its own, it is made at the one place a member is made, and the member is
// always the one who can say it isn't working.

const DAY = 86_400_000;

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  return { ...fixtures, lane, recruitmentTask, alice: holder, bob };
}

async function admit(setup: Awaited<ReturnType<typeof setUp>>, email = "dana@example.com", name = "Dana") {
  const { arrival } = await createAdmissionArrival({
    communityId: setup.community.id,
    cycleId: null,
    email,
    name,
    lane: setup.lane,
    route: "application",
  });
  const result = await admitArrival(arrival.id, { notify: false });
  if (!result.memberId) throw new Error("not admitted");
  const [row] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, result.memberId));
  const [newcomer] = await db.select().from(member).where(eq(member.id, result.memberId));
  return { memberId: result.memberId, newcomer, accompanimentRow: row ?? null };
}

async function claimAs(memberId: string, taskId: string) {
  const [m] = await db.select().from(member).where(eq(member.id, memberId));
  await claimTask(m, taskId);
}

describe("making an accompaniment", () => {
  beforeEach(resetDatabase);

  it("is made when a member is made, named for them, with an end fixed at the start", async () => {
    const setup = await setUp();
    const { memberId, accompanimentRow } = await admit(setup);
    expect(accompanimentRow).not.toBeNull();
    const [t] = await db.select().from(task).where(eq(task.id, accompanimentRow!.taskId));
    expect(t).toMatchObject({ title: "Accompany Dana", status: "unclaimed", branchId: setup.branch.id });
    expect(accompanimentRow!.endsOn.getTime() - accompanimentRow!.startedAt.getTime()).toBe(90 * DAY);
    // A new member sees that someone will be named, and who once somebody has taken it on.
    const before = await getMyAccompaniment(memberId);
    expect(before).toMatchObject({ endedAt: null, accompanier: null });
    await claimAs(setup.bob.id, t.id);
    expect((await getMyAccompaniment(memberId))!.accompanier).toMatchObject({ id: setup.bob.id });
  });

  it("is made once, whatever calls it", async () => {
    const setup = await setUp();
    const { memberId, accompanimentRow } = await admit(setup);
    const [arrival] = await db.select().from(admission).where(eq(admission.admittedMemberId, memberId));
    const again = await ensureAccompaniment(arrival, memberId, { isNewMember: true });
    expect(again).toEqual({ status: "skipped", reason: "already" });
    expect(await db.select().from(accompaniment).where(eq(accompaniment.memberId, memberId))).toHaveLength(1);
    expect(accompanimentRow).not.toBeNull();
  });

  it("is not made for someone who turns out to be a member already, who isn't new", async () => {
    const setup = await setUp();
    const { arrival } = await createAdmissionArrival({
      communityId: setup.community.id,
      cycleId: null,
      email: "existing@example.com",
      name: "Existing",
      lane: setup.lane,
      route: "application",
    });
    // Somebody gives this address an account while the request is in flight (an administrator
    // adds them, say). Admission links to that member rather than making a second one.
    const [existing] = await db.insert(member).values({ communityId: setup.community.id, name: "Existing" }).returning();
    await db.insert(memberIdentity).values({ memberId: existing.id, provider: "magic_link", loginEmail: "existing@example.com" });
    const result = await admitArrival(arrival.id, { notify: false });
    expect(result).toMatchObject({ memberId: existing.id, created: false });
    expect(await db.select().from(accompaniment).where(eq(accompaniment.memberId, existing.id))).toHaveLength(0);
  });

  it("is not made at all when the community has turned it off", async () => {
    const setup = await setUp();
    await updateCommunity(setup.alice, { accompanimentEnabled: false });
    const { accompanimentRow } = await admit(setup);
    expect(accompanimentRow).toBeNull();
    expect(await db.select().from(task).where(eq(task.title, "Accompany Dana"))).toHaveLength(0);
  });

  it("follows the community's own length and tier, and a tier from elsewhere is refused", async () => {
    const setup = await setUp();
    const [core] = await db.insert(tier).values({ communityId: setup.community.id, name: "Core" }).returning();
    await updateCommunity(setup.alice, { accompanimentEndsAfterDays: 30, accompanimentTierId: core.id });
    const { accompanimentRow } = await admit(setup);
    expect(accompanimentRow!.endsOn.getTime() - accompanimentRow!.startedAt.getTime()).toBe(30 * DAY);
    const requirements = await db.select().from(requirement).where(eq(requirement.taskId, accompanimentRow!.taskId));
    expect(requirements).toMatchObject([{ type: "tier", value: { tierId: core.id } }]);

    await expect(updateCommunity(setup.alice, { accompanimentTierId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("makes nothing, rather than guessing, when nobody can be the one to create the task", async () => {
    const setup = await setUp();
    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, setup.recruitmentTask.id));
    const { arrival } = await createAdmissionArrival({
      communityId: setup.community.id,
      cycleId: null,
      email: "x@example.com",
      name: "X",
      lane: setup.lane,
      route: "application",
    });
    // Nobody holds recruitment now, and nobody invited or reported on this arrival, so there is
    // nobody to create the task as. The person is still admitted.
    const result = await admitArrival(arrival.id, { notify: false });
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, result.memberId!));
    expect(row).toBeUndefined();
  });
});

describe("what the accompanier can see, and when", () => {
  beforeEach(resetDatabase);

  it("is the new member's record only while the accompaniment is open", async () => {
    const setup = await setUp();
    const { memberId, accompanimentRow } = await admit(setup);
    const taskId = accompanimentRow!.taskId;
    expect(await getAccompaniedMemberId(taskId)).toBe(memberId);
    expect(await getAccompaniedMemberId(setup.recruitmentTask.id)).toBeNull();

    await claimAs(setup.bob.id, taskId);
    const [bob] = await db.select().from(member).where(eq(member.id, setup.bob.id));
    await finishTask(bob, taskId);
    // Finishing the task ends it, even before the job notices.
    expect(await getAccompaniedMemberId(taskId)).toBeNull();
    expect((await getMyAccompaniment(memberId))!.endedAt).not.toBeNull();
  });
});

describe("asking for someone else", () => {
  beforeEach(resetDatabase);

  it("gives the task back with a plain note, keeps the accompaniment open, and holds nothing against anyone", async () => {
    const setup = await setUp();
    const { newcomer, accompanimentRow } = await admit(setup);
    const taskId = accompanimentRow!.taskId;

    // Nobody holds it yet, so there is nobody to change, and it says so.
    await expect(askForSomeoneElse(newcomer)).rejects.toBeInstanceOf(ConflictError);

    await claimAs(setup.bob.id, taskId);
    await askForSomeoneElse(newcomer);

    const [t] = await db.select().from(task).where(eq(task.id, taskId));
    expect(t.status).toBe("unclaimed");
    expect(await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, taskId))).toHaveLength(0);
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, accompanimentRow!.id));
    expect(row.endedAt).toBeNull();
    expect(row.askedForSomeoneElseAt).not.toBeNull();
    const comments = await db.select().from(taskComment).where(eq(taskComment.taskId, taskId));
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toMatch(/nobody's fault/);
    expect(comments[0].body).not.toMatch(/Bob/);

    // Someone else takes it, and the member's card names them.
    await claimAs(setup.alice.id, taskId);
    expect((await getMyAccompaniment(newcomer.id))!.accompanier).toMatchObject({ id: setup.alice.id });
  });

  it("is for the member whose accompaniment it is, and nobody else", async () => {
    const setup = await setUp();
    await admit(setup);
    await expect(askForSomeoneElse(setup.bob)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the scheduled job", () => {
  beforeEach(resetDatabase);

  it("ends an accompaniment that has run out, closes its task, and can run again harmlessly", async () => {
    const setup = await setUp();
    const { memberId, accompanimentRow } = await admit(setup);
    await claimAs(setup.bob.id, accompanimentRow!.taskId);

    await runAccompaniments(new Date(Date.now() + 89 * DAY));
    expect((await getMyAccompaniment(memberId))!.endedAt).toBeNull();

    await runAccompaniments(new Date(Date.now() + 91 * DAY));
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, accompanimentRow!.id));
    expect(row.endedAt).not.toBeNull();
    const [t] = await db.select().from(task).where(eq(task.id, accompanimentRow!.taskId));
    expect(t.status).toBe("done");
    expect(await getAccompaniedMemberId(accompanimentRow!.taskId)).toBeNull();
    const mine = await getMyAccompaniment(memberId);
    expect(mine!.accompanier).toBeNull();

    await runAccompaniments(new Date(Date.now() + 92 * DAY));
    expect((await db.select().from(accompaniment).where(eq(accompaniment.id, row.id)))[0].endedAt?.getTime()).toBe(row.endedAt!.getTime());
  });

  it("tells the member who is accompanying them once, and again only when it changes hands", async () => {
    const setup = await setUp();
    const { newcomer, accompanimentRow } = await admit(setup);
    const read = async () => (await db.select().from(accompaniment).where(eq(accompaniment.id, accompanimentRow!.id)))[0].announcedHolderId;

    await runAccompaniments();
    expect(await read()).toBeNull();

    await claimAs(setup.bob.id, accompanimentRow!.taskId);
    await runAccompaniments();
    expect(await read()).toBe(setup.bob.id);
    await runAccompaniments();
    expect(await read()).toBe(setup.bob.id);

    await askForSomeoneElse(newcomer);
    await runAccompaniments();
    expect(await read()).toBeNull();

    await claimAs(setup.alice.id, accompanimentRow!.taskId);
    await runAccompaniments();
    expect(await read()).toBe(setup.alice.id);
  });
});

describe("a task someone finishes by hand", () => {
  beforeEach(resetDatabase);

  it("is noticed by the job, which records that the accompaniment ended", async () => {
    const setup = await setUp();
    const { accompanimentRow } = await admit(setup);
    await claimAs(setup.bob.id, accompanimentRow!.taskId);
    const [bob] = await db.select().from(member).where(eq(member.id, setup.bob.id));
    await finishTask(bob, accompanimentRow!.taskId);
    await runAccompaniments();
    const [row] = await db.select().from(accompaniment).where(and(eq(accompaniment.id, accompanimentRow!.id)));
    expect(row.endedAt).not.toBeNull();
  });
});
