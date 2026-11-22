import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { community, cycle, phase } from "@/db/schema";
import { createDayLabeler } from "@/lib/dates";
import { loadDayScopes } from "@/lib/day-labeler";
import { createFixtures, resetDatabase } from "./helpers";

// The loader behind getDayLabeler: every event in one community, with its
// phases, in two queries. The labeler over them is covered without a
// database in tests/day-labeler.test.ts.

beforeEach(async () => {
  await resetDatabase();
});

describe("loadDayScopes", () => {
  it("loads each event with its phases, including a closed one", async () => {
    const { community: c } = await createFixtures();
    const [open] = await db
      .insert(cycle)
      .values({ communityId: c.id, name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" })
      .returning();
    const [closed] = await db
      .insert(cycle)
      .values({
        communityId: c.id,
        name: "Last year",
        startDate: "2026-03-05",
        endDate: "2026-03-08",
        closedAt: new Date("2026-04-01T00:00:00Z"),
      })
      .returning();
    await db.insert(phase).values([
      { cycleId: open.id, name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" },
      { cycleId: open.id, name: "Wind-down", order: 2, startDate: "2027-03-08", endDate: null },
    ]);

    const scopes = await loadDayScopes(c.id);

    expect([...scopes.keys()].sort()).toEqual([open.id, closed.id].sort());
    const loaded = scopes.get(open.id);
    expect(loaded?.cycle).toEqual({ id: open.id, name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" });
    expect(loaded?.phases.map((p) => [p.name, p.order, p.startDate, p.endDate])).toEqual([
      ["Set-up", 1, "2027-03-01", "2027-03-03"],
      ["Wind-down", 2, "2027-03-08", null],
    ]);
    expect(scopes.get(closed.id)?.phases).toEqual([]);
  });

  it("never loads another community's events or phases", async () => {
    const { community: mine } = await createFixtures();
    const [other] = await db.insert(community).values({ name: "Elsewhere" }).returning();
    const [theirs] = await db
      .insert(cycle)
      .values({ communityId: other.id, name: "Theirs", startDate: "2027-03-04", endDate: "2027-03-07" })
      .returning();
    await db
      .insert(phase)
      .values({ cycleId: theirs.id, name: "Their set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" });
    const [ours] = await db
      .insert(cycle)
      .values({ communityId: mine.id, name: "Ours", startDate: "2027-03-04", endDate: "2027-03-07" })
      .returning();

    const scopes = await loadDayScopes(mine.id);

    expect([...scopes.keys()]).toEqual([ours.id]);
    expect(scopes.get(ours.id)?.phases).toEqual([]);
    expect(scopes.has(theirs.id)).toBe(false);
  });

  it("feeds a labeler that reads a day in terms of the loaded phase", async () => {
    const { community: c } = await createFixtures();
    const [event] = await db
      .insert(cycle)
      .values({ communityId: c.id, name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" })
      .returning();
    const [setup] = await db
      .insert(phase)
      .values({ cycleId: event.id, name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" })
      .returning();

    const labeler = createDayLabeler("period", await loadDayScopes(c.id));

    expect(labeler.label("2027-03-02", { cycleId: event.id }).visible).toBe("Peach Please · Set-up · Tue");
    expect(labeler.label("2027-03-02", { phaseId: setup.id }, { cycleId: event.id }).visible).toBe("Set-up · Tue");
    expect(labeler.label("2027-03-20", { cycleId: event.id }).visible).toBe("Mar 20, 2027");
  });
});
