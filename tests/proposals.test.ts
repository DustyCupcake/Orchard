import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, taskAssignment } from "@/db/schema";
import {
  activateProposal,
  createProposal,
  declineProposal,
  getProposal,
  listProposals,
} from "@/lib/proposals";
import { listTaskDependencies } from "@/lib/tasks";
import { listGrantingTaskIds } from "@/lib/permissions";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

describe("creating and listing proposals", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("accepts a bare-bones title + description proposal", async () => {
    const { alice } = await createFixtures();
    const created = await createProposal(alice, { title: "Fix the gate latch" });

    expect(created.status).toBe("pending");
    expect(created.submittedBy).toBe(alice.id);
    expect(created.description).toBe("");
  });

  it("rejects suggesting a member from another community", async () => {
    const { alice } = await createFixtures();
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [outsider] = await db
      .insert(member)
      .values({ communityId: otherCommunity.id, name: "Outsider" })
      .returning();

    await expect(
      createProposal(alice, { title: "Fix the gate latch", suggestedMemberId: outsider.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lists proposals scoped to the community and filterable by status", async () => {
    const { alice, bob } = await createFixtures();
    await createProposal(alice, { title: "First" });
    const second = await createProposal(bob, { title: "Second" });
    await declineProposal(bob, second.id);

    const pending = await listProposals(alice, { status: "pending" });
    expect(pending.map((p) => p.title)).toEqual(["First"]);

    const all = await listProposals(alice);
    expect(all).toHaveLength(2);
  });

  it("enforces tenant isolation on getProposal", async () => {
    const { alice } = await createFixtures();
    const proposal = await createProposal(alice, { title: "Fix the gate latch" });

    const { alice: strangerAlice } = await createFixtures();
    await expect(getProposal(strangerAlice, proposal.id)).rejects.toThrow(NotFoundError);
  });
});

describe("activating a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a real Task, crediting the original proposer as creator", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, {
      title: "Fix the gate latch",
      description: "It sticks in the rain",
    });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect(created.title).toBe("Fix the gate latch");
    expect(created.description).toBe("It sticks in the rain");
    expect(created.createdBy).toBe(bob.id);
    expect(created.status).toBe("unclaimed");

    const refreshed = await getProposal(alice, proposal.id);
    expect(refreshed.status).toBe("activated");
    expect(refreshed.activatedTaskId).toBe(created.id);
  });

  it("lets the activator override the title and description", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, { title: "gate thing" });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      title: "Fix the gate latch",
      description: "Polished by coordination",
    });

    expect(created.title).toBe("Fix the gate latch");
    expect(created.description).toBe("Polished by coordination");
  });

  it("carries suggestedMemberId through onto the new task", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(alice, {
      title: "Fix the gate latch",
      suggestedMemberId: bob.id,
      suggestedMemberNote: "Bob's handy with this stuff",
    });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect(created.suggestedMemberId).toBe(bob.id);
  });

  it("attaches Requirements passed at activation time", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, { title: "Fix the gate latch" });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      requirements: [{ type: "custom", value: { flag: "welding_cert" } }],
    });

    const rows = await db.select().from(task).where(eq(task.id, created.id));
    expect(rows).toHaveLength(1);
  });

  it("attaches Dependencies passed at activation time", async () => {
    const { branch, alice, bob } = await createFixtures();
    const [existingTask] = await db
      .insert(task)
      .values({
        communityId: alice.communityId,
        branchId: branch.id,
        title: "Order the lumber",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
      })
      .returning();
    const proposal = await createProposal(bob, { title: "Build the frame" });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      dependsOnTaskIds: [existingTask.id],
    });

    const deps = await listTaskDependencies(alice, created.id);
    expect(deps.map((d) => d.dependsOnTaskId)).toEqual([existingTask.id]);
  });

  // docs/development-plan.md's Phase 64 — "Permissions granted by this
  // task" on the activation screen itself, a follow-up write against
  // the newly-created task's own id (see crud.ts's own comment on why
  // it can't be folded into createTask). Alice counts as Admin here
  // purely via the pre-latch "any member" fallback (adminsEverClaimed
  // is false on a fresh fixture community) — the negative case below
  // needs a real latched Admin gate to prove the fallback isn't what's
  // silently making this pass.
  it("attaches PermissionGrant rows passed at activation time when the activator is an Admin", async () => {
    const { branch, alice, bob, community: testCommunity } = await createFixtures();
    const proposal = await createProposal(bob, { title: "Fix the gate latch" });

    const { task: created } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      grantModuleKeys: ["recruitment"],
    });

    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([created.id]);
  });

  it("silently skips grantModuleKeys for a non-Admin activator, without blocking activation itself", async () => {
    const { branch, alice, bob, community: testCommunity } = await createFixtures();
    const [adminsTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: branch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        openness: "community_endorsed",
        createdBy: alice.id,
      })
      .returning();
    await grantPermission(testCommunity.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, testCommunity.id));

    const proposal = await createProposal(bob, { title: "Fix the gate latch" });
    const { task: created } = await activateProposal(bob, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      grantModuleKeys: ["recruitment"],
    });

    expect(created.id).toBeTruthy();
    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([]);
  });

  it("auto-claims for the proposer when wantsToClaim is set", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, { title: "Fix the gate latch", wantsToClaim: true });

    const { task: created, autoClaimed } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect(autoClaimed).toBe(true);
    expect(created.status).toBe("claimed");
  });

  it("still activates even if the auto-claim can't go through", async () => {
    const { branch, alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, { title: "Fix the gate latch", wantsToClaim: true });

    const { task: created, autoClaimed } = await activateProposal(alice, proposal.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      requirements: [{ type: "custom", value: { flag: "welding_cert" } }],
    });

    expect(autoClaimed).toBe(false);
    expect(created.status).toBe("unclaimed");

    const refreshed = await getProposal(alice, proposal.id);
    expect(refreshed.status).toBe("activated");
  });

  it("rejects activating an already-activated or declined proposal", async () => {
    const { branch, alice, bob } = await createFixtures();
    const activated = await createProposal(bob, { title: "One" });
    await activateProposal(alice, activated.id, {
      branchId: branch.id,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await expect(
      activateProposal(alice, activated.id, {
        branchId: branch.id,
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(ConflictError);

    const declined = await createProposal(bob, { title: "Two" });
    await declineProposal(alice, declined.id);
    await expect(
      activateProposal(alice, declined.id, {
        branchId: branch.id,
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("declining a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records the decline with an optional reason and blocks further action", async () => {
    const { alice, bob } = await createFixtures();
    const proposal = await createProposal(bob, { title: "Repaint the shed a different color" });

    const declined = await declineProposal(alice, proposal.id, "already scheduled for next year");
    expect(declined.status).toBe("declined");
    expect(declined.declineReason).toBe("already scheduled for next year");

    await expect(declineProposal(alice, proposal.id)).rejects.toThrow(ConflictError);
  });
});
