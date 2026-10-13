import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, community, member, memberAxisValue, task, taskAssignment, traitAxis } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { claimAsShadow, claimTask } from "@/lib/tasks";
import { askForSomeoneElse, getAccompaniedView, getMyAccompaniment, runAccompaniments, setMyShares } from "@/lib/accompaniment";
import { accompanierMaySee } from "@/lib/accompaniment-access";
import { getVisibleContribution } from "@/lib/contribution";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

// docs/plans/accompaniment-plan.md step 4a: what a new member lets their accompanier see beyond the
// basics. Off until they say; for one person, not a role; and every door fails closed.

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  const { arrival } = await createAdmissionArrival({ communityId: c.id, cycleId: null, email: "dana@example.com", name: "Dana", lane, route: "application" });
  const result = await admitArrival(arrival.id, { notify: false });
  const [dana] = await db.select().from(member).where(eq(member.id, result.memberId!));
  const [acc] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, dana.id));
  return { ...fixtures, alice: holder, carol, dana, taskId: acc.taskId, accompanimentId: acc.id };
}

async function claimAs(memberId: string, taskId: string) {
  const [m] = await db.select().from(member).where(eq(member.id, memberId));
  await claimTask(m, taskId);
}

const asMember = async (id: string) => (await db.select().from(member).where(eq(member.id, id)))[0];

async function giveDanaAScale(danaId: string, communityId: string, value = 1) {
  const [axis] = await db.insert(traitAxis).values({ communityId, key: "direction", lowLabel: "wants direction", highLabel: "wants independence" }).returning();
  await db.insert(memberAxisValue).values({ memberId: danaId, axisId: axis.id, value });
  return axis;
}

describe("choosing what to share", () => {
  beforeEach(resetDatabase);

  it("needs somebody to choose it for, and an accompaniment that is open", async () => {
    const s = await setUp();
    await expect(setMyShares(s.dana, { axes: true, contribution: false })).rejects.toBeInstanceOf(ConflictError);
    await expect(setMyShares(s.bob, { axes: true, contribution: false })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is off until they say, and then is for the person accompanying them", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    expect((await getMyAccompaniment(s.dana.id))!.shares).toEqual({ axes: false, contribution: false, answers: false });

    await setMyShares(s.dana, { axes: true, contribution: false });
    expect((await getMyAccompaniment(s.dana.id))!.shares).toEqual({ axes: true, contribution: false, answers: false });
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, s.accompanimentId));
    expect(row).toMatchObject({ sharedWithMemberId: s.bob.id, sharesAxes: true, sharesContribution: false });
  });
});

describe("what the accompanier sees", () => {
  beforeEach(resetDatabase);

  it("is nothing beyond the basics by default, and says so", async () => {
    const s = await setUp();
    await giveDanaAScale(s.dana.id, s.community.id);
    await claimAs(s.bob.id, s.taskId);
    const view = await getAccompaniedView(await asMember(s.bob.id), s.taskId);
    expect(view).toMatchObject({ name: "Dana", axes: null, contribution: null, shares: { axes: false, contribution: false, answers: false } });
  });

  it("is the working style once shared, in words and not as a number", async () => {
    const s = await setUp();
    await giveDanaAScale(s.dana.id, s.community.id, 2);
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: false });
    const view = await getAccompaniedView(await asMember(s.bob.id), s.taskId);
    expect(view!.axes).toEqual([{ axis: "wants direction to wants independence", position: "strongly toward wants independence" }]);
    expect(view!.contribution).toBeNull();
  });

  it("is the contribution overview once shared, counted and not listed", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: false, contribution: true });
    const view = await getAccompaniedView(await asMember(s.bob.id), s.taskId);
    expect(view!.axes).toBeNull();
    expect(Array.isArray(view!.contribution)).toBe(true);
  });

  it("is only for whoever holds the task: not another member, not a shadow, not the person themselves", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: true });
    expect(await getAccompaniedView(await asMember(s.alice.id), s.taskId)).toBeNull();
    await claimAsShadow(await asMember(s.carol.id), s.taskId);
    expect(await getAccompaniedView(await asMember(s.carol.id), s.taskId)).toBeNull();
    expect(await accompanierMaySee(s.dana.id, s.dana.id, "axes")).toBe(false);
    expect(await accompanierMaySee(s.alice.id, s.dana.id, "axes")).toBe(false);
    expect(await accompanierMaySee(s.bob.id, s.dana.id, "axes")).toBe(true);
  });

  it("is nothing once the accompaniment is over", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: true });
    await runAccompaniments(new Date(Date.now() + 100 * 86_400_000));
    expect(await getAccompaniedView(await asMember(s.bob.id), s.taskId)).toBeNull();
    expect(await accompanierMaySee(s.bob.id, s.dana.id, "axes")).toBe(false);
  });
});

describe("the contribution page", () => {
  beforeEach(resetDatabase);

  it("opens for the accompanier the person chose, and for nobody else", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    const bob = await asMember(s.bob.id);
    await expect(getVisibleContribution(bob, s.dana.id)).rejects.toBeInstanceOf(ForbiddenError);

    await setMyShares(s.dana, { axes: false, contribution: true });
    expect((await getVisibleContribution(bob, s.dana.id)).memberName).toBe("Dana");
    await expect(getVisibleContribution(await asMember(s.alice.id), s.dana.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is not opened by choosing only the other thing", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: false });
    await expect(getVisibleContribution(await asMember(s.bob.id), s.dana.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("consent is to a person", () => {
  beforeEach(resetDatabase);

  it("starts from nothing for a new accompanier, and says so to the member", async () => {
    const s = await setUp();
    await giveDanaAScale(s.dana.id, s.community.id);
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: true });

    // Bob lets go quietly; Alice takes over. Nothing was rewritten for that to be true.
    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, s.taskId));
    await db.update(task).set({ status: "unclaimed" }).where(eq(task.id, s.taskId));
    await claimAs(s.alice.id, s.taskId);

    const mine = await getMyAccompaniment(s.dana.id);
    expect(mine!.shares).toEqual({ axes: false, contribution: false, answers: false });
    expect(mine!.sharesWereForSomeoneElse).toBe(true);
    const view = await getAccompaniedView(await asMember(s.alice.id), s.taskId);
    expect(view).toMatchObject({ axes: null, contribution: null });
    expect(await accompanierMaySee(s.alice.id, s.dana.id, "axes")).toBe(false);
  });

  it("is put away for good when the member asks for someone else, so it can't wake up if the same person returns", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: true, contribution: true });
    await askForSomeoneElse(s.dana);

    await claimAs(s.bob.id, s.taskId);
    expect((await getMyAccompaniment(s.dana.id))!.shares).toEqual({ axes: false, contribution: false, answers: false });
    expect(await accompanierMaySee(s.bob.id, s.dana.id, "contribution")).toBe(false);
  });

  it("is put away by the job too, when a different person has taken over", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await runAccompaniments();
    await setMyShares(s.dana, { axes: true, contribution: false });

    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, s.taskId));
    await db.update(task).set({ status: "unclaimed" }).where(eq(task.id, s.taskId));
    await claimAs(s.alice.id, s.taskId);
    await runAccompaniments();

    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, s.accompanimentId));
    expect(row).toMatchObject({ sharedWithMemberId: null, sharesAxes: false, sharesContribution: false });
  });
});
