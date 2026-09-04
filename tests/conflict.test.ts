import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import {
  acknowledgeConflictReport,
  escalateConflictReport,
  fileConflictReport,
  getConflictReport,
  isConflictTeamMember,
  listConflictReportExclusions,
  listConflictReports,
  recusePeer,
  recuseSelf,
  resolveConflictReport,
} from "@/lib/conflict";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function insertConflictTeamTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Conflict team",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      capacity: 4,
      critical: true,
      createdBy,
    })
    .returning();
  return row;
}

async function setUpTeam() {
  const { community: testCommunity, branch, alice, bob } = await createFixtures();
  const [carol] = await db
    .insert(member)
    .values({ communityId: testCommunity.id, name: "Carol" })
    .returning();
  const teamTask = await insertConflictTeamTask(testCommunity.id, branch.id, alice.id);
  await claimTask(alice, teamTask.id);
  await claimTask(bob, teamTask.id);
  // carol is a member but deliberately not on the team.
  await grantPermission(testCommunity.id, "conflict_team", teamTask.id);

  return { community: testCommunity, branch, alice, bob, carol, teamTask };
}

describe("isConflictTeamMember", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false when the module isn't set up at all", async () => {
    const { alice } = await createFixtures();
    expect(await isConflictTeamMember(alice)).toBe(false);
  });

  it("is true for a real holder of the designated task, false for a shadow", async () => {
    const { alice, carol, teamTask } = await setUpTeam();
    expect(await isConflictTeamMember(alice)).toBe(true);

    await db.insert(taskAssignment).values({ taskId: teamTask.id, memberId: carol.id, isShadow: true });
    expect(await isConflictTeamMember(carol)).toBe(false);
  });
});

describe("filing a report", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects filing when the module isn't set up", async () => {
    const { alice } = await createFixtures();
    await expect(fileConflictReport(alice, {})).rejects.toThrow(AppError);
  });

  it("lets any member file a low-friction report with no description", async () => {
    const { carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    expect(report.reportedBy).toBe(carol.id);
    expect(report.description).toBeNull();
    expect(report.acknowledgedAt).toBeNull();
  });

  it("excludes specific team members at creation time", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {
      description: "Something happened",
      excludeMemberIds: [alice.id],
    });

    const exclusions = await listConflictReportExclusions(bob, report.id);
    expect(exclusions.map((e) => e.memberId)).toEqual([alice.id]);

    await expect(getConflictReport(alice, report.id)).rejects.toThrow(NotFoundError);
  });

  it("rejects excluding a member outside the community", async () => {
    const { carol } = await setUpTeam();
    const { alice: stranger } = await createFixtures();
    await expect(
      fileConflictReport(carol, { excludeMemberIds: [stranger.id] }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("the invisibility guarantee", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("hides an excluded team member's report entirely — list and single-fetch alike", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, { excludeMemberIds: [alice.id] });

    const aliceList = await listConflictReports(alice);
    expect(aliceList.map((r) => r.id)).not.toContain(report.id);
    await expect(getConflictReport(alice, report.id)).rejects.toThrow(NotFoundError);

    const bobList = await listConflictReports(bob);
    expect(bobList.map((r) => r.id)).toContain(report.id);
  });

  it("is invisible to a non-reporter, non-team-member entirely", async () => {
    const { carol } = await setUpTeam();
    const { alice: outsider } = await createFixtures();
    const report = await fileConflictReport(carol, {});
    expect((await listConflictReports(outsider)).map((r) => r.id)).not.toContain(report.id);
  });

  it("narrows visibility to reporter + point-of-contact once acknowledged", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});

    await acknowledgeConflictReport(alice, report.id);

    // bob is a team member but not the point of contact — no longer sees it.
    expect((await listConflictReports(bob)).map((r) => r.id)).not.toContain(report.id);
    // alice (point of contact) and carol (reporter) still do.
    expect((await listConflictReports(alice)).map((r) => r.id)).toContain(report.id);
    expect((await listConflictReports(carol)).map((r) => r.id)).toContain(report.id);
  });

  it("widens back to the whole non-excluded team once escalated", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await acknowledgeConflictReport(alice, report.id);
    await escalateConflictReport(carol, report.id);

    expect((await listConflictReports(bob)).map((r) => r.id)).toContain(report.id);
  });
});

describe("recusal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a team member recuse themselves, after which they can't see it", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});

    await recuseSelf(alice, report.id);

    expect((await listConflictReports(alice)).map((r) => r.id)).not.toContain(report.id);
  });

  it("lets one team member recuse another", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});

    await recusePeer(alice, report.id, bob.id);

    expect((await listConflictReports(bob)).map((r) => r.id)).not.toContain(report.id);
    const exclusions = await listConflictReportExclusions(alice, report.id);
    expect(exclusions.map((e) => ({ memberId: e.memberId, addedBy: e.addedBy }))).toEqual([
      { memberId: bob.id, addedBy: alice.id },
    ]);
  });

  it("rejects recusal from someone who isn't a current team member", async () => {
    const { carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await expect(recuseSelf(carol, report.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects peer-recusing someone who isn't a current team member", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await expect(recusePeer(alice, report.id, carol.id)).rejects.toThrow(NotFoundError);
  });
});

describe("acknowledge / resolve / escalate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("acknowledging makes that team member the point of contact", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});

    const updated = await acknowledgeConflictReport(alice, report.id);
    expect(updated.acknowledgedBy).toBe(alice.id);
    expect(updated.acknowledgedAt).not.toBeNull();
  });

  it("rejects acknowledging twice", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await acknowledgeConflictReport(alice, report.id);
    await expect(acknowledgeConflictReport(alice, report.id)).rejects.toThrow(ConflictError);
  });

  it("rejects acknowledging from a non-team-member", async () => {
    const { carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await expect(acknowledgeConflictReport(carol, report.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects resolving before acknowledgment", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await expect(
      resolveConflictReport(alice, report.id, { resolutionNote: "done" }),
    ).rejects.toThrow(ConflictError);
  });

  it("only the point of contact can resolve", async () => {
    const { alice, bob, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await acknowledgeConflictReport(alice, report.id);

    // bob can't even see it anymore post-acknowledgment (narrowed
    // visibility), so this surfaces as NotFoundError, not Forbidden —
    // consistent with the invisibility model.
    await expect(
      resolveConflictReport(bob, report.id, { resolutionNote: "nope" }),
    ).rejects.toThrow(NotFoundError);

    const resolved = await resolveConflictReport(alice, report.id, { resolutionNote: "Talked it through" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolutionNote).toBe("Talked it through");
  });

  it("only the reporter can escalate", async () => {
    const { alice, carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await expect(escalateConflictReport(alice, report.id)).rejects.toThrow(ForbiddenError);

    const escalated = await escalateConflictReport(carol, report.id);
    expect(escalated.escalated).toBe(true);
  });

  it("rejects escalating twice", async () => {
    const { carol } = await setUpTeam();
    const report = await fileConflictReport(carol, {});
    await escalateConflictReport(carol, report.id);
    await expect(escalateConflictReport(carol, report.id)).rejects.toThrow(ConflictError);
  });
});
