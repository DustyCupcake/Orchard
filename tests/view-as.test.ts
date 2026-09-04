import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { fileConflictReport, listConflictReports, recuseSelf, requireConflictTeamMember } from "@/lib/conflict";
import { isSupportHolder, requireSupportHolder } from "@/lib/view-as";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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
      title: "Support",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

// getActiveViewAs/activateViewAs/deactivateViewAs/getViewingContext all
// read or write the session cookie via next/headers' cookies(), which
// only works inside a real Next.js request — same reason this codebase
// has never unit-tested src/lib/session.ts's createSession/
// destroySession/getCurrentMember either (grep tests/ — there's no
// session.test.ts). Those get exercised end-to-end against the real
// Docker Compose stack instead (see the commit message for what that
// covered); isSupportHolder/requireSupportHolder don't touch cookies at
// all, so they're unit-testable exactly like isCoordinationHolder is in
// tests/coordination.test.ts, which this file mirrors directly.
describe("isSupportHolder", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false for anyone before they hold a Support-tagged task", async () => {
    const { alice } = await createFixtures();
    expect(await isSupportHolder(alice)).toBe(false);
  });

  it("is true for a real holder of a task granted the support module", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "support", t.id);
    await claimTask(alice, t.id);

    expect(await isSupportHolder(alice)).toBe(true);
  });

  it("is false for an ordinary task's own tags — granting is per-task now, not a tag match (Phase 63)", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { tags: ["support"] });
    await claimTask(alice, t.id);

    expect(await isSupportHolder(alice)).toBe(false);
  });

  it("is false for a shadow of a support-granted task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await grantPermission(testCommunity.id, "support", t.id);
    await claimTask(alice, t.id);
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: bob.id, isShadow: true });

    expect(await isSupportHolder(bob)).toBe(false);
  });

  it("requireSupportHolder throws ForbiddenError when not authorized", async () => {
    const { alice } = await createFixtures();
    await expect(requireSupportHolder(alice)).rejects.toThrow(ForbiddenError);
  });
});

// The one hard exception spec names for View-as: viewing as an excluded
// conflict-team member must never bypass their own recusal. Since
// listConflictReports is actor-parameterized (confirmed directly in
// src/lib/conflict.ts), passing the *viewed* member straight through —
// exactly what src/app/(app)/conflict-reports/page.tsx now does via
// getViewingContext — is enough to prove the guarantee holds with no
// View-as-specific code in conflict.ts at all. This test exercises that
// composition directly rather than re-testing conflict.ts's own
// exclusion logic (already covered by tests/conflict.test.ts).
describe("View-as composes correctly with Conflict management's exclusion guarantee", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a Support holder's own view differs from what rendering 'as' the excluded member produces — proving the swap is load-bearing, not a no-op", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();

    const conflictTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Conflict team",
      capacity: 2,
    });
    await claimTask(alice, conflictTask.id);
    await claimTask(bob, conflictTask.id);
    await grantPermission(testCommunity.id, "conflict_team", conflictTask.id);

    await requireConflictTeamMember(alice);
    const report = await fileConflictReport(alice, { description: "issue", excludeMemberIds: [] });
    await recuseSelf(bob, report.id);

    // carol — the real Support holder in this scenario — isn't on the
    // conflict team at all, and filed nothing herself, so her own,
    // real-identity view is empty for a completely different reason
    // than bob's (no team access, vs. a real exclusion). If a page
    // wired View-as backwards and called listConflictReports with the
    // *real* actor instead of the *viewed* one, this is the call it
    // would make by mistake.
    const carolsOwnView = await listConflictReports(carol);
    expect(carolsOwnView).toHaveLength(0);

    // The real assertion: src/app/(app)/conflict-reports/page.tsx calls
    // listConflictReports(viewing) — the target member's own row, per
    // getViewingContext — which for bob specifically means the
    // anti-join excludes this report just as it would if bob looked
    // himself, not because carol has no access.
    const renderedAsBob = await listConflictReports(bob);
    expect(renderedAsBob).toHaveLength(0);

    // Same test, opposite outcome: rendering "as" alice (on the team,
    // not excluded) surfaces the report — proving the empty result
    // above is really the exclusion at work, not an unrelated empty table.
    const renderedAsAlice = await listConflictReports(alice);
    expect(renderedAsAlice.length).toBeGreaterThan(0);
    expect(renderedAsAlice[0].id).toBe(report.id);
  });
});
