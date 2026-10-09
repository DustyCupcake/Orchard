import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  confirmEventProposalSlot,
  createEventProposal,
  declineEventProposal,
  getProposalInterest,
  listOpenEventProposalsForInterest,
  publishEventSchedule,
  setEventProposalInterest,
} from "@/lib/event-scheduling";
import { AppError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

function iso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}
const slot = (a: number, b: number) => ({ startsAt: iso(a), endsAt: iso(b) });

// alice owns the programme, bob proposes, carol is an ordinary member.
async function setUp() {
  const fixtures = await createFixtures();
  const { alice, bob, branch } = fixtures;
  await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
  const [ownerTask] = await db
    .insert(task)
    .values({
      communityId: alice.communityId,
      branchId: branch.id,
      title: "Scheduling owner",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy: alice.id,
    })
    .returning();
  await claimTask(alice, ownerTask.id);
  await grantPermission(alice.communityId, "event_scheduling_owner", ownerTask.id);
  const [carol] = await db.insert(member).values({ communityId: alice.communityId, name: "Carol" }).returning();
  const proposal = await createEventProposal(bob, {
    host: "Bob",
    title: "Reunion dinner",
    durationMinutes: 120,
    preferredSlots: [slot(24, 30)],
  });
  return { ...fixtures, carol, proposal };
}

describe("Proposal interest", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records, changes and withdraws a member's own response", async () => {
    const { carol, proposal } = await setUp();

    await setEventProposalInterest(carol, proposal.id, "maybe");
    expect((await getProposalInterest(carol, [proposal])).get(proposal.id)).toMatchObject({
      yes: 0,
      maybe: 1,
      mine: "maybe",
    });

    // Changing it replaces it rather than adding a second.
    await setEventProposalInterest(carol, proposal.id, "yes");
    expect((await getProposalInterest(carol, [proposal])).get(proposal.id)).toMatchObject({
      yes: 1,
      maybe: 0,
      mine: "yes",
    });

    await setEventProposalInterest(carol, proposal.id, null);
    expect((await getProposalInterest(carol, [proposal])).get(proposal.id)).toMatchObject({
      yes: 0,
      maybe: 0,
      mine: null,
    });
  });

  it("withdrawing when there was no response is harmless", async () => {
    const { carol, proposal } = await setUp();
    await expect(setEventProposalInterest(carol, proposal.id, null)).resolves.toBeNull();
  });

  it("shows every member the counts but only names to the submitter and the scheduling owner", async () => {
    const { alice, bob, carol, proposal } = await setUp();
    await setEventProposalInterest(carol, proposal.id, "yes");
    await setEventProposalInterest(alice, proposal.id, "maybe");

    // The submitter and the owner see who.
    const forBob = (await getProposalInterest(bob, [proposal])).get(proposal.id)!;
    expect(forBob).toMatchObject({ yes: 1, maybe: 1 });
    expect(forBob.people?.map((p) => [p.name, p.level]).sort()).toEqual([
      ["Alice", "maybe"],
      ["Carol", "yes"],
    ]);
    expect((await getProposalInterest(alice, [proposal])).get(proposal.id)!.people).toHaveLength(2);

    // An ordinary member sees the numbers and nothing else.
    const forCarol = (await getProposalInterest(carol, [proposal])).get(proposal.id)!;
    expect(forCarol).toMatchObject({ yes: 1, maybe: 1, mine: "yes" });
    expect(forCarol.people).toBeNull();
  });

  it("doesn't let a host respond to their own proposal", async () => {
    const { bob, proposal } = await setUp();
    await expect(setEventProposalInterest(bob, proposal.id, "yes")).rejects.toThrow(AppError);
  });

  it("closes to responses once the proposal is declined or published", async () => {
    const { alice, bob, carol, proposal } = await setUp();
    const declined = await createEventProposal(bob, {
      host: "Bob",
      title: "Not happening",
      durationMinutes: 60,
      preferredSlots: [slot(48, 50)],
    });
    await declineEventProposal(alice, declined.id);
    await expect(setEventProposalInterest(carol, declined.id, "yes")).rejects.toThrow(AppError);

    await confirmEventProposalSlot(alice, proposal.id, slot(24, 26));
    await publishEventSchedule(alice);
    await expect(setEventProposalInterest(carol, proposal.id, "yes")).rejects.toThrow(AppError);
  });

  it("is refused while the module is off, and can't reach another community's proposal", async () => {
    const { alice, carol, proposal } = await setUp();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(setEventProposalInterest(carol, proposal.id, "yes")).rejects.toThrow(AppError);

    await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
    await expect(
      setEventProposalInterest(carol, "00000000-0000-0000-0000-000000000000", "yes"),
    ).rejects.toThrow(NotFoundError);
  });

  it("lists other members' open proposals, leaving out the viewer's own, declined and published ones", async () => {
    const { alice, bob, carol, proposal } = await setUp();
    const mine = await createEventProposal(carol, {
      host: "Carol",
      title: "Carol's walk",
      durationMinutes: 60,
      preferredSlots: [slot(30, 32)],
    });
    const declined = await createEventProposal(bob, {
      host: "Bob",
      title: "Declined",
      durationMinutes: 60,
      preferredSlots: [slot(48, 50)],
    });
    await declineEventProposal(alice, declined.id);

    const visible = await listOpenEventProposalsForInterest(carol);
    expect(visible.map((p) => p.id)).toEqual([proposal.id]);
    expect(visible.map((p) => p.id)).not.toContain(mine.id);

    // Publishing needs every proposal resolved, so settle Carol's own too.
    await declineEventProposal(alice, mine.id);
    await confirmEventProposalSlot(alice, proposal.id, slot(24, 26));
    await publishEventSchedule(alice);
    expect(await listOpenEventProposalsForInterest(carol)).toEqual([]);
  });
});
