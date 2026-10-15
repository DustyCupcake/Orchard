import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, community, member } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { claimTask } from "@/lib/tasks";
import { runAccompaniments } from "@/lib/accompaniment";

// The "someone has taken on accompanying you" email is a notification: it says something that is also on the
// member's dashboard, so it respects their "email me" setting. Mocked at the mailer so a test can see the send.
vi.mock("@/lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mailer")>();
  return { ...actual, sendAccompanierNamedEmail: vi.fn() };
});
import { sendAccompanierNamedEmail } from "@/lib/mailer";

async function setUp(wantsEmail: boolean) {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  const { arrival } = await createAdmissionArrival({ communityId: c.id, cycleId: null, email: "dana@example.com", name: "Dana", lane, route: "application" });
  const result = await admitArrival(arrival.id, { notify: false });
  await db.update(member).set({ emailNotificationsEnabled: wantsEmail }).where(eq(member.id, result.memberId!));
  const [acc] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, result.memberId!));
  const [bobRow] = await db.select().from(member).where(eq(member.id, bob.id));
  await claimTask(bobRow, acc.taskId);
  return { accompanimentId: acc.id, bobId: bob.id };
}

describe("telling a new member who is accompanying them", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(sendAccompanierNamedEmail).mockClear();
  });

  it("emails them, once, when they want email", async () => {
    const s = await setUp(true);
    await runAccompaniments();
    await runAccompaniments();
    expect(sendAccompanierNamedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendAccompanierNamedEmail).mock.calls[0][0]).toBe("dana@example.com");
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, s.accompanimentId));
    expect(row.announcedHolderId).toBe(s.bobId);
  });

  it("does not email someone who has asked not to be, and still marks it told so it isn't retried", async () => {
    const s = await setUp(false);
    await runAccompaniments();
    expect(sendAccompanierNamedEmail).not.toHaveBeenCalled();
    const [row] = await db.select().from(accompaniment).where(eq(accompaniment.id, s.accompanimentId));
    expect(row.announcedHolderId).toBe(s.bobId);
  });
});
