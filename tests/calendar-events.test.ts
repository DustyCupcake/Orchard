import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, member, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { createCycle, updateCycleSettings } from "@/lib/cycles";
import {
  acceptCalendarEventInvite,
  createCalendarEvent,
  declineCalendarEventInvite,
  deleteCalendarEvent,
  getCalendarEvent,
  inviteBranchRosterToCalendarEvent,
  inviteCommunityToCalendarEvent,
  inviteMemberToCalendarEvent,
  listCalendarEventInvites,
  listMyCalendarEventInvites,
  listMyCalendarEvents,
  updateCalendarEvent,
} from "@/lib/calendar-events";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Water the trees",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("creating and resolving a CalendarEvent's date", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("absolute resolves to its exact date", async () => {
    const { alice } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "The potluck",
      date: { type: "absolute", date: "2027-06-15" },
    });
    expect(e.date).toBe("2027-06-15");
    expect(e.cycleId).toBeNull();
  });

  it("relative offset resolves against the given Cycle", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    const e = await createCalendarEvent(alice, {
      title: "Applications close",
      cycleId: cyc.id,
      date: { type: "relative_offset", anchor: "cycle_end", offsetDays: -14 },
    });
    expect(e.date).toBe("2027-12-17");
  });

  it("relative percent resolves proportionally", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-11",
    });
    const e = await createCalendarEvent(alice, {
      title: "Midpoint check-in",
      cycleId: cyc.id,
      date: { type: "relative_percent", percent: 50 },
    });
    expect(e.date).toBe("2027-01-06");
  });

  it("stays unresolved when the Cycle has no dates yet", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, { source: "blank", name: "Season" });
    const e = await createCalendarEvent(alice, {
      title: "Someday",
      cycleId: cyc.id,
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 3 },
    });
    expect(e.date).toBeNull();
  });

  it("reverse-computes the offset from a dragged target date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
    });
    const e = await createCalendarEvent(alice, {
      title: "Dragged",
      cycleId: cyc.id,
      date: { type: "relative_offset", anchor: "cycle_start", targetDate: "2027-02-01" },
    });
    expect(e.offsetDays).toBe(31);
    expect(e.date).toBe("2027-02-01");
  });

  it("rejects a Cycle from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: stranger } = await createFixtures();
    await enableCycles(stranger.communityId);
    const strangerCycle = await createCycle(stranger, { source: "blank", name: "Elsewhere" });

    await expect(
      createCalendarEvent(alice, {
        title: "x",
        cycleId: strangerCycle.id,
        date: { type: "absolute", date: "2027-01-01" },
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("sharing generates invites", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("personal generates no invites", async () => {
    const { alice } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "Just for me",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "personal",
    });
    expect(await listCalendarEventInvites(alice, e.id)).toHaveLength(0);
  });

  it("community fans out to every member except the creator", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "Everyone's invited",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "community",
    });
    const invites = await listCalendarEventInvites(alice, e.id);
    expect(invites.map((i) => i.invite.memberId)).toEqual([bob.id]);
    expect(invites[0].invite.status).toBe("invited");
  });

  it("branch fans out to the current task-holding roster of that Branch", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    // Bob holds a task in the branch; Carol holds one in a different branch.
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: testCommunity.id, name: "Other" })
      .returning();
    const inBranch = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(bob, inBranch.id);
    const elsewhere = await insertTask(testCommunity.id, otherBranch.id, alice.id);
    await claimTask(carol, elsewhere.id);

    const e = await createCalendarEvent(alice, {
      title: "Branch potluck",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "branch",
      sharedBranchId: testBranch.id,
    });
    const invites = await listCalendarEventInvites(alice, e.id);
    expect(invites.map((i) => i.invite.memberId)).toEqual([bob.id]);

    // Re-triggering the same bulk invite later catches anyone who's
    // newly holding a task in the Branch since the last pass.
    const [dave] = await db.insert(member).values({ communityId: testCommunity.id, name: "Dave" }).returning();
    const secondTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(dave, secondTask.id);
    await inviteBranchRosterToCalendarEvent(alice, e.id, testBranch.id);
    const invitesAfter = await listCalendarEventInvites(alice, e.id);
    expect(new Set(invitesAfter.map((i) => i.invite.memberId))).toEqual(new Set([bob.id, dave.id]));
  });

  it("requires sharedBranchId when shareTarget is branch", async () => {
    const { alice } = await createFixtures();
    await expect(
      createCalendarEvent(alice, {
        title: "x",
        date: { type: "absolute", date: "2027-01-01" },
        shareTarget: "branch",
      }),
    ).rejects.toThrow();
  });
});

describe("invite → accept/decline", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("an invited member sees it as a pending invite until they respond", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);

    const pending = await listMyCalendarEventInvites(bob);
    expect(pending.map((i) => i.eventId)).toEqual([e.id]);
    expect(await listMyCalendarEvents(bob)).toHaveLength(0); // not on their calendar yet
  });

  it("accepting puts it on the invitee's own calendar", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);
    await acceptCalendarEventInvite(bob, e.id);

    expect(await listMyCalendarEventInvites(bob)).toHaveLength(0);
    const mine = await listMyCalendarEvents(bob);
    expect(mine.map((m) => m.id)).toEqual([e.id]);
  });

  it("declining drops it from the pending list but keeps a real record (unlike Placement)", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);
    const declined = await declineCalendarEventInvite(bob, e.id);
    expect(declined.status).toBe("declined");

    expect(await listMyCalendarEventInvites(bob)).toHaveLength(0);
    expect(await listMyCalendarEvents(bob)).toHaveLength(0);
    const invites = await listCalendarEventInvites(alice, e.id);
    expect(invites).toHaveLength(1);
    expect(invites[0].invite.status).toBe("declined");
  });

  it("rejects accepting/declining with no pending invite", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await expect(acceptCalendarEventInvite(bob, e.id)).rejects.toThrow(NotFoundError);
    await expect(declineCalendarEventInvite(bob, e.id)).rejects.toThrow(NotFoundError);
  });

  it("rejects inviting the same member twice", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);
    await expect(inviteMemberToCalendarEvent(alice, e.id, bob.id)).rejects.toThrow(ConflictError);
  });

  it("rejects the creator inviting themselves", async () => {
    const { alice } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await expect(inviteMemberToCalendarEvent(alice, e.id, alice.id)).rejects.toThrow(AppError);
  });

  it("only the creator can invite people", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await expect(inviteMemberToCalendarEvent(bob, e.id, bob.id)).rejects.toThrow(ForbiddenError);
  });

  it("re-running a bulk invite skips already-invited and already-declined members", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "x",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "community",
    });
    await declineCalendarEventInvite(bob, e.id);

    await inviteCommunityToCalendarEvent(alice, e.id);
    const invites = await listCalendarEventInvites(alice, e.id);
    expect(invites).toHaveLength(1); // still just the one row, still declined
    expect(invites[0].invite.status).toBe("declined");
  });
});

describe("editing, deleting, and visibility", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only the creator can edit or delete", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await expect(updateCalendarEvent(bob, e.id, { title: "Hijacked" })).rejects.toThrow(ForbiddenError);
    await expect(deleteCalendarEvent(bob, e.id)).rejects.toThrow(ForbiddenError);
  });

  it("the creator can edit the date and title at any time", async () => {
    const { alice } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    const updated = await updateCalendarEvent(alice, e.id, {
      title: "y",
      date: { type: "absolute", date: "2027-02-01" },
    });
    expect(updated.title).toBe("y");
    expect(updated.date).toBe("2027-02-01");
  });

  it("clears a stale sharedBranchId when shareTarget moves away from 'branch'", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "x",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "branch",
      sharedBranchId: testBranch.id,
    });
    expect(e.sharedBranchId).toBe(testBranch.id);

    const updated = await updateCalendarEvent(alice, e.id, { shareTarget: "personal" });
    expect(updated.sharedBranchId).toBeNull();
  });

  it("deleting removes the event and its invites", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);
    await deleteCalendarEvent(alice, e.id);
    await expect(getCalendarEvent(alice, e.id)).rejects.toThrow(NotFoundError);
  });

  it("personal is visible only to the creator", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "x",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "personal",
    });
    await expect(getCalendarEvent(bob, e.id)).rejects.toThrow(NotFoundError);
    await expect(getCalendarEvent(alice, e.id)).resolves.toBeTruthy();
  });

  it("community-shared is visible to any community member, invited or not", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "x",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "personal", // deliberately not community, to isolate the visibility check
    });
    await updateCalendarEvent(alice, e.id, { shareTarget: "community" });
    await expect(getCalendarEvent(bob, e.id)).resolves.toBeTruthy();
  });

  it("branch-shared stays invite-only for viewing (no real Branch roster to check against)", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    const e = await createCalendarEvent(alice, {
      title: "x",
      date: { type: "absolute", date: "2027-01-01" },
      shareTarget: "branch",
      sharedBranchId: testBranch.id,
    });
    // Bob was never actually invited (no task holdings in the branch).
    await expect(getCalendarEvent(bob, e.id)).rejects.toThrow(NotFoundError);
  });

  it("an invited (even declined) member can still see the event", async () => {
    const { alice, bob } = await createFixtures();
    const e = await createCalendarEvent(alice, { title: "x", date: { type: "absolute", date: "2027-01-01" } });
    await inviteMemberToCalendarEvent(alice, e.id, bob.id);
    await declineCalendarEventInvite(bob, e.id);
    await expect(getCalendarEvent(bob, e.id)).resolves.toBeTruthy();
  });
});

describe("cascading recompute and drift, mirroring Phase 39's Phase boundaries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("recomputes the cached date when the Cycle's own dates move", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, { source: "blank", name: "Season", startDate: "2027-01-01" });
    const e = await createCalendarEvent(alice, {
      title: "x",
      cycleId: cyc.id,
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 10 },
    });
    expect(e.date).toBe("2027-01-11");

    await updateCycleSettings(alice, cyc.id, { startDate: "2027-02-01" });
    const after = await getCalendarEvent(alice, e.id);
    expect(after.date).toBe("2027-02-11");
  });

  it("surfaces the drift flag once the Cycle's dates move the event closer to the other end", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-31",
    });
    const e = await createCalendarEvent(alice, {
      title: "x",
      cycleId: cyc.id,
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 4 },
    });
    expect((await getCalendarEvent(alice, e.id)).drifted).toBe(false);

    await updateCycleSettings(alice, cyc.id, { endDate: "2027-01-06" });
    expect((await getCalendarEvent(alice, e.id)).drifted).toBe(true);
  });
});
