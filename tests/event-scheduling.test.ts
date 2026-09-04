import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  confirmEventProposalSlot,
  createEventProposal,
  declineEventProposal,
  getEventProposal,
  listEventProposalsForReview,
  listMyEventProposalPings,
  listMyEventProposals,
  listPublishedSchedule,
  pingConflictHost,
  publishEventSchedule,
  updateEventProposal,
} from "@/lib/event-scheduling";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function insertOwnerTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Scheduling owner",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
    })
    .returning();
  return row;
}

function iso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function slot(startHour: number, endHour: number) {
  return { startsAt: iso(startHour), endsAt: iso(endHour) };
}

async function setUpModule() {
  const fixtures = await createFixtures();
  const { alice, branch: testBranch } = fixtures;
  await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
  const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
  await claimTask(alice, ownerTask.id);
  await grantPermission(alice.communityId, "event_scheduling_owner", ownerTask.id);
  return { ...fixtures, ownerTask };
}

describe("EventProposal submission", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects while the module is off", async () => {
    const { alice } = await createFixtures();
    await expect(
      createEventProposal(alice, {
        host: "Alice",
        title: "Fire circle",
        durationMinutes: 60,
        preferredSlots: [slot(24, 25)],
      }),
    ).rejects.toThrow(AppError);
  });

  it("creates a proposal once the module is on", async () => {
    const { bob } = await setUpModule();
    const created = await createEventProposal(bob, {
      host: "Bob",
      title: "Fire circle",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    expect(created.status).toBe("proposed");
    expect(created.submittedBy).toBe(bob.id);

    const mine = await listMyEventProposals(bob);
    expect(mine.map((p) => p.id)).toEqual([created.id]);
  });

  it("rejects a cycle from another community", async () => {
    const { bob } = await setUpModule();
    const { community: strangerCommunity } = await createFixtures();
    const [strangerCycle] = await db
      .insert(cycle)
      .values({ communityId: strangerCommunity.id, name: "Foreign cycle" })
      .returning();
    await expect(
      createEventProposal(bob, {
        host: "Bob",
        title: "Fire circle",
        durationMinutes: 60,
        preferredSlots: [slot(24, 25)],
        cycleId: strangerCycle.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("EventProposal editing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets the submitter edit while proposed", async () => {
    const { bob } = await setUpModule();
    const created = await createEventProposal(bob, {
      host: "Bob",
      title: "Fire circle",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    const updated = await updateEventProposal(bob, created.id, { title: "Renamed" });
    expect(updated.title).toBe("Renamed");
  });

  it("rejects an edit from anyone but the submitter", async () => {
    const { alice, bob } = await setUpModule();
    const created = await createEventProposal(bob, {
      host: "Bob",
      title: "Fire circle",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await expect(updateEventProposal(alice, created.id, { title: "Hijacked" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("rejects editing once confirmed, declined, or published", async () => {
    const { alice, bob } = await setUpModule();
    const confirmedOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Confirmed session",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await confirmEventProposalSlot(alice, confirmedOne.id, slot(24, 25));
    await expect(updateEventProposal(bob, confirmedOne.id, { title: "X" })).rejects.toThrow(AppError);

    const declinedOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Declined session",
      durationMinutes: 60,
      preferredSlots: [slot(30, 31)],
    });
    await declineEventProposal(alice, declinedOne.id);
    await expect(updateEventProposal(bob, declinedOne.id, { title: "X" })).rejects.toThrow(AppError);
  });
});

describe("Conflict detection", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("flags two proposals sharing a space with overlapping slots", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    const b = await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24.5, 25.5)],
    });

    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("conflict");
    expect(byId.get(b.id)?.status).toBe("conflict");
  });

  it("doesn't flag overlapping slots in different spaces", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    const b = await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      spaceNeeds: "Chill dome",
      preferredSlots: [slot(24, 25)],
    });

    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("proposed");
    expect(byId.get(b.id)?.status).toBe("proposed");
  });

  it("doesn't flag proposals with no spaceNeeds at all", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    const b = await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });

    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("proposed");
    expect(byId.get(b.id)?.status).toBe("proposed");
  });

  it("doesn't flag non-overlapping slots in the same space", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    const b = await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(26, 27)],
    });

    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("proposed");
    expect(byId.get(b.id)?.status).toBe("proposed");
  });

  it("clears once an edit removes the overlap", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    const b = await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24.5, 25.5)],
    });
    await listEventProposalsForReview(alice);
    expect((await getEventProposal(alice, a.id)).status).toBe("conflict");

    await updateEventProposal(bob, b.id, { preferredSlots: [slot(30, 31)] });
    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(a.id)?.status).toBe("proposed");
    expect(byId.get(b.id)?.status).toBe("proposed");
  });

  it("flags a still-open proposal against an already-confirmed slot, without re-flagging the confirmed one", async () => {
    const { alice, bob } = await setUpModule();
    const confirmedOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Confirmed",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    await confirmEventProposalSlot(alice, confirmedOne.id, slot(24, 25));

    const openOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Still open",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24.5, 25.5)],
    });

    const reviewed = await listEventProposalsForReview(alice);
    const byId = new Map(reviewed.map((p) => [p.id, p]));
    expect(byId.get(confirmedOne.id)?.status).toBe("confirmed");
    expect(byId.get(openOne.id)?.status).toBe("conflict");
  });

  it("review is owner-only", async () => {
    const { bob } = await setUpModule();
    await expect(listEventProposalsForReview(bob)).rejects.toThrow(ForbiddenError);
  });
});

describe("Confirm / decline / ping", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("confirming is owner-only and can use a compromise slot outside the original preferences", async () => {
    const { alice, bob } = await setUpModule();
    const proposal = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });

    const compromiseSlot = slot(40, 41);
    await expect(confirmEventProposalSlot(bob, proposal.id, compromiseSlot)).rejects.toThrow(
      ForbiddenError,
    );

    const confirmed = await confirmEventProposalSlot(alice, proposal.id, compromiseSlot);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedSlot).toEqual(compromiseSlot);
  });

  it("declining is owner-only", async () => {
    const { alice, bob } = await setUpModule();
    const proposal = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await expect(declineEventProposal(bob, proposal.id)).rejects.toThrow(ForbiddenError);
    const declined = await declineEventProposal(alice, proposal.id);
    expect(declined.status).toBe("declined");
  });

  it("pinging only works on a genuinely conflicted proposal, and is visible to the submitter", async () => {
    const { alice, bob } = await setUpModule();
    const a = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    await createEventProposal(bob, {
      host: "Bob",
      title: "B",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24.5, 25.5)],
    });

    // Not yet flagged (no review pass has run).
    await expect(pingConflictHost(alice, a.id)).rejects.toThrow(ConflictError);

    await listEventProposalsForReview(alice);
    await pingConflictHost(alice, a.id);

    const pings = await listMyEventProposalPings(bob, a.id);
    expect(pings).toHaveLength(1);
    expect(pings[0].createdBy).toBe(alice.id);

    const { alice: strangerAlice } = await createFixtures();
    await expect(listMyEventProposalPings(strangerAlice, a.id)).rejects.toThrow();
  });
});

describe("Publication", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects publishing while any proposal is still proposed or conflicted", async () => {
    const { alice, bob } = await setUpModule();
    await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await expect(publishEventSchedule(alice)).rejects.toThrow(ConflictError);
  });

  it("returns a zero count when there's nothing pending to publish", async () => {
    const { alice } = await setUpModule();
    const result = await publishEventSchedule(alice);
    expect(result.publishedCount).toBe(0);
  });

  it("publishing is owner-only", async () => {
    const { bob } = await setUpModule();
    await expect(publishEventSchedule(bob)).rejects.toThrow(ForbiddenError);
  });

  it("publishes once every proposal resolves, and locks + reveals them", async () => {
    const { alice, bob } = await setUpModule();
    const confirmedOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Confirmed session",
      durationMinutes: 60,
      spaceNeeds: "Main stage",
      preferredSlots: [slot(24, 25)],
    });
    const declinedOne = await createEventProposal(bob, {
      host: "Bob",
      title: "Declined session",
      durationMinutes: 60,
      preferredSlots: [slot(30, 31)],
    });
    await confirmEventProposalSlot(alice, confirmedOne.id, slot(24, 25));
    await declineEventProposal(alice, declinedOne.id);

    expect(await listPublishedSchedule(bob)).toHaveLength(0);

    const result = await publishEventSchedule(alice);
    expect(result.publishedCount).toBe(2);

    const published = await listPublishedSchedule(bob);
    expect(published.map((p) => p.id).sort()).toEqual([confirmedOne.id, declinedOne.id].sort());

    // Locked from further edits.
    await expect(updateEventProposal(bob, confirmedOne.id, { title: "X" })).rejects.toThrow(AppError);
    await expect(confirmEventProposalSlot(alice, confirmedOne.id, slot(50, 51))).rejects.toThrow(
      ConflictError,
    );
    await expect(declineEventProposal(alice, declinedOne.id)).rejects.toThrow(ConflictError);
  });

  it("listPublishedSchedule is community-scoped", async () => {
    const { alice, bob } = await setUpModule();
    const proposal = await createEventProposal(bob, {
      host: "Bob",
      title: "A",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await confirmEventProposalSlot(alice, proposal.id, slot(24, 25));
    await publishEventSchedule(alice);

    const { bob: strangerBob } = await createFixtures();
    expect(await listPublishedSchedule(strangerBob)).toHaveLength(0);
  });
});
