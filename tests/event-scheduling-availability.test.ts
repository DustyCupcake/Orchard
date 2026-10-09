import { describe, expect, it } from "vitest";
import {
  candidatePlacements,
  collapseCellsToWindows,
  commonPlacementWindow,
  expandWindowsToCells,
  gridDays,
  gridWeeks,
  windowMinutes,
  windowsForceClash,
} from "@/lib/event-scheduling";
import type { EventSlot } from "@/lib/event-scheduling";

// No database. The slot arithmetic behind painted availability — what a
// painted shape *means*, and when two proposals genuinely clash.

const CELL = 30 * 60_000;

/** Cells painted from a wall-clock list, as the grid would produce them. */
function cells(...hours: string[]): string[] {
  return hours.map((h) => new Date(`2026-09-10T${h}:00Z`).toISOString());
}

function window(startsAt: string, endsAt: string): EventSlot {
  return { startsAt, endsAt };
}

describe("collapseCellsToWindows", () => {
  it("reads a run of touching half-hours as one window", () => {
    // Three cells, 15:00-16:30, is one window a 90-minute session fits.
    const painted = cells("15:00", "15:30", "16:00");
    const windows = collapseCellsToWindows(painted);
    expect(windows).toEqual([
      {
        startsAt: new Date("2026-09-10T15:00:00Z").toISOString(),
        endsAt: new Date("2026-09-10T16:30:00Z").toISOString(),
      },
    ]);
    expect(windowMinutes(windows[0])).toBe(90);
  });

  it("reads a single cell as a 30-minute window", () => {
    expect(windowMinutes(collapseCellsToWindows(cells("15:00"))[0])).toBe(30);
  });

  it("breaks a run at a gap rather than spanning time the host didn't paint", () => {
    const windows = collapseCellsToWindows(cells("15:00", "16:00"));
    expect(windows).toHaveLength(2);
    expect(windowMinutes(windows[0])).toBe(30);
    expect(windowMinutes(windows[1])).toBe(30);
  });

  it("sorts unordered cells", () => {
    expect(collapseCellsToWindows(cells("16:00", "15:00", "15:30"))).toEqual(
      collapseCellsToWindows(cells("15:00", "15:30", "16:00")),
    );
  });

  // A DST fall-back makes two wall clocks the same instant, so the grid
  // can legitimately paint one cell twice. Storing it twice would inflate
  // every duration calculation downstream.
  it("collapses a duplicate cell", () => {
    const painted = cells("15:00", "15:30", "15:30", "16:00");
    expect(collapseCellsToWindows(painted)).toHaveLength(1);
    expect(windowMinutes(collapseCellsToWindows(painted)[0])).toBe(90);
  });

  it("has no windows when nothing is painted", () => {
    expect(collapseCellsToWindows([])).toEqual([]);
  });

  it("does not treat a non-adjacent gap as touching", () => {
    // 15:00 and 15:29 are close but not a cell apart.
    const painted = [new Date("2026-09-10T15:00:00Z").toISOString(), new Date("2026-09-10T15:29:00Z").toISOString()];
    expect(collapseCellsToWindows(painted)).toHaveLength(2);
  });
});

describe("expandWindowsToCells", () => {
  it("round-trips a window that is a whole number of cells", () => {
    const windows = collapseCellsToWindows(cells("15:00", "15:30", "16:00"));
    expect(expandWindowsToCells(windows)).toEqual(cells("15:00", "15:30", "16:00"));
  });

  // A stored window is normally grid-authored, so this is a backstop for
  // hand-edited or migrated data, not the normal path. Rounding up would
  // paint a host into time they said they were unavailable.
  it("drops a partial trailing cell rather than rounding into it", () => {
    const partial = window("2026-09-10T15:00:00.000Z", "2026-09-10T15:45:00.000Z");
    expect(expandWindowsToCells([partial])).toEqual(cells("15:00"));
  });
});

describe("candidatePlacements", () => {
  const threeHours = window("2026-09-10T15:00:00.000Z", "2026-09-10T18:00:00.000Z");

  it("offers every half-hour start that fits the duration", () => {
    // A 90-minute session in a 15:00-18:00 window: 15:00, 15:30, 16:00,
    // 16:30 — the last ending exactly on 18:00, so it fits. Nothing at
    // 17:00, which would run to 18:30.
    expect(candidatePlacements([threeHours], 90).map((p) => p.startsAt)).toEqual([
      "2026-09-10T15:00:00.000Z",
      "2026-09-10T15:30:00.000Z",
      "2026-09-10T16:00:00.000Z",
      "2026-09-10T16:30:00.000Z",
    ]);
  });

  it("offers one start for a session exactly as long as its window", () => {
    expect(candidatePlacements([threeHours], 180)).toHaveLength(1);
  });

  it("offers nothing when no window is long enough", () => {
    // A host who painted 30 minutes for a two-hour session has not
    // offered that session any placement.
    expect(
      candidatePlacements([window("2026-09-10T15:00:00.000Z", "2026-09-10T15:30:00.000Z")], 120),
    ).toEqual([]);
  });

  it("counts each window separately, so a gap splits the options", () => {
    const twoWindows = [
      window("2026-09-10T15:00:00.000Z", "2026-09-10T16:00:00.000Z"),
      window("2026-09-10T17:00:00.000Z", "2026-09-10T18:00:00.000Z"),
    ];
    // Two disjoint one-hour windows, a 60-minute session: one each.
    expect(candidatePlacements(twoWindows, 60)).toHaveLength(2);
  });

  it("places nothing at all for a missing or nonsensical duration", () => {
    expect(candidatePlacements([threeHours], 0)).toEqual([]);
    expect(candidatePlacements([threeHours], -30)).toEqual([]);
    expect(candidatePlacements([threeHours], Number.NaN)).toEqual([]);
  });

  it("places nothing when no availability was painted", () => {
    expect(candidatePlacements([], 60)).toEqual([]);
  });

  // The grid's summary line counts placements over raw cells with its own
  // deliberately-duplicated helper. If the two ever disagree, the host is
  // shown a number that isn't true.
  it("agrees with the grid's cell-based counter on the cases that matter", () => {
    const countOverCells = (painted: string[], durationMinutes: number) => {
      if (durationMinutes <= 0 || painted.length === 0) return 0;
      const needed = Math.ceil(durationMinutes / 30);
      const times = [...new Set(painted.map((c) => new Date(c).getTime()))].sort((a, b) => a - b);
      const runs: number[] = [];
      let run = 0;
      for (let i = 0; i < times.length; i++) {
        if (i > 0 && times[i] - times[i - 1] === CELL) run += 1;
        else {
          if (run > 0) runs.push(run);
          run = 1;
        }
      }
      if (run > 0) runs.push(run);
      return runs.reduce((sum, r) => sum + Math.max(0, r - needed + 1), 0);
    };

    for (const painted of [
      cells("15:00", "15:30", "16:00"),
      cells("15:00", "15:30", "16:00", "16:30", "17:00"),
      cells("15:00", "16:00"),
      cells("15:00"),
      cells("15:00", "15:30", "15:30"),
    ]) {
      for (const duration of [30, 60, 90, 120, 180]) {
        expect(countOverCells(painted, duration)).toBe(
          candidatePlacements(collapseCellsToWindows(painted), duration).length,
        );
      }
    }
  });
});

describe("commonPlacementWindow", () => {
  const at = (s: string, e: string) => window(`2026-09-10T${s}:00.000Z`, `2026-09-10T${e}:00.000Z`);

  it("finds a back-to-back run when everything fits", () => {
    // Both free from 15:00; two hours can sit side by side.
    const common = commonPlacementWindow([
      { windows: [at("15:00", "18:00")], durationMinutes: 60 },
      { windows: [at("15:00", "18:00")], durationMinutes: 60 },
    ]);
    expect(common?.startsAt).toBe("2026-09-10T15:00:00.000Z");
    expect(common?.endsAt).toBe("2026-09-10T17:00:00.000Z");
  });

  it("starts at the earliest stretch that fits, not merely any", () => {
    // B isn't free until 17:00. A back-to-back pair can't start before
    // 16:00, because anything earlier puts B before it can. 15:00 and
    // 15:30 both fail; 16:00 works (A at 16:00, B at 17:00).
    const common = commonPlacementWindow([
      { windows: [at("15:00", "20:00")], durationMinutes: 60 },
      { windows: [at("17:00", "20:00")], durationMinutes: 60 },
    ]);
    expect(common?.startsAt).toBe("2026-09-10T16:00:00.000Z");
    expect(common?.endsAt).toBe("2026-09-10T18:00:00.000Z");
  });

  // The overlap case, and the reason this is worth having over pairwise
  // flags alone: A 15:00-16:30 and B 15:30-17:00 overlap, so they'd be
  // flagged as clashing — but A at 15:00 and B at 16:00 are both inside
  // their own painted availability, so the programme actually fits.
  it("fits two overlapping windows by using different starts in each", () => {
    const common = commonPlacementWindow([
      { windows: [at("15:00", "16:30")], durationMinutes: 60 },
      { windows: [at("15:30", "17:00")], durationMinutes: 60 },
    ]);
    expect(common?.startsAt).toBe("2026-09-10T15:00:00.000Z");
    expect(common?.endsAt).toBe("2026-09-10T17:00:00.000Z");
  });

  it("gives null when two placeable proposals can't be sequenced", () => {
    // A needs two hours and only has one start (15:00). B has exactly
    // one start too (16:00), which is inside A's run. Both are
    // individually placeable, so neither gets skipped — and there's no
    // ordering that works.
    expect(
      commonPlacementWindow([
        { windows: [at("15:00", "17:00")], durationMinutes: 120 },
        { windows: [at("16:00", "16:30")], durationMinutes: 30 },
      ]),
    ).toBeNull();
  });

  it("gives null for a single proposal with nowhere to go", () => {
    expect(commonPlacementWindow([{ windows: [at("15:00", "15:30")], durationMinutes: 120 }])).toBeNull();
  });

  // A proposal that can't be placed anywhere can't be a constraint on the
  // others — and if it's the only one, returning null would hide the
  // useful fact that it has nowhere to go rather than report it.
  it("skips a proposal with no valid placement instead of failing on it", () => {
    const common = commonPlacementWindow([
      { windows: [at("15:00", "17:00")], durationMinutes: 60 },
      { windows: [at("15:00", "15:30")], durationMinutes: 300 },
    ]);
    expect(common?.startsAt).toBe("2026-09-10T15:00:00.000Z");
    expect(common?.endsAt).toBe("2026-09-10T16:00:00.000Z");
  });

  it("gives null when there's nothing to place", () => {
    expect(commonPlacementWindow([])).toBeNull();
    expect(commonPlacementWindow([{ windows: [], durationMinutes: 60 }])).toBeNull();
    expect(commonPlacementWindow([{ windows: [at("15:00", "16:00")], durationMinutes: 0 }])).toBeNull();
  });

  it("places three proposals back to back", () => {
    const common = commonPlacementWindow([
      { windows: [at("15:00", "20:00")], durationMinutes: 60 },
      { windows: [at("15:00", "20:00")], durationMinutes: 30 },
      { windows: [at("15:00", "20:00")], durationMinutes: 90 },
    ]);
    expect(common?.startsAt).toBe("2026-09-10T15:00:00.000Z");
    expect(common?.endsAt).toBe("2026-09-10T18:00:00.000Z");
  });
});

describe("windowsForceClash", () => {
  const w = (start: string, end: string) => window(`2026-09-10T${start}:00.000Z`, `2026-09-10T${end}:00.000Z`);

  it("is never a clash when the windows don't overlap", () => {
    expect(windowsForceClash(w("15:00", "16:00"), w("16:00", "17:00"), 60, 60)).toBe(false);
  });

  // The case plain overlap got wrong, and the reason this function
  // exists: these two can run back to back.
  it("is not a clash when one can dodge inside its own availability", () => {
    // A is free 15:00-17:00, B wants 15:30-16:00. A can take 16:00-17:00.
    expect(windowsForceClash(w("15:00", "17:00"), w("15:30", "16:00"), 60, 60)).toBe(false);
  });

  it("is a clash when neither can dodge", () => {
    // Both want the same single hour. A's clear stretch is 15:00-15:30,
    // B's is 16:00-16:30 — 30 minutes each, neither enough for an hour.
    expect(windowsForceClash(w("15:00", "16:00"), w("15:30", "16:30"), 60, 60)).toBe(true);
  });

  // One hour each inside a shared 90 minutes leaves 30 minutes of slack —
  // not enough for either session, so this really is a clash.
  // Two proposals that painted the same afternoon can run back to back;
  // plain overlap called these a clash.
  it("is not a clash when identical windows can hold both sessions in sequence", () => {
    expect(windowsForceClash(w("15:00", "17:00"), w("15:00", "17:00"), 60, 60)).toBe(false);
    expect(windowsForceClash(w("15:00", "18:00"), w("15:00", "18:00"), 90, 90)).toBe(false);
  });

  it("is not a clash when staggered windows leave room for both", () => {
    // A at 15:00-16:00, B at 16:00-17:00.
    expect(windowsForceClash(w("15:00", "16:30"), w("15:30", "17:00"), 60, 60)).toBe(false);
  });

  it("is a clash when the shared window can't hold both sessions", () => {
    // Ninety minutes can't hold two one-hour sessions.
    expect(windowsForceClash(w("15:00", "16:30"), w("15:00", "16:30"), 60, 60)).toBe(true);
  });

  it("respects each side's own duration", () => {
    const a = w("15:00", "16:30");
    const b = w("15:00", "16:30");
    expect(windowsForceClash(a, b, 60, 60)).toBe(true);
    // Sessions needing only 30 fit side by side.
    expect(windowsForceClash(a, b, 30, 30)).toBe(false);
    // A 30 and a 60 fit in 90 together.
    expect(windowsForceClash(a, b, 30, 60)).toBe(false);
    // A 90 and a 30 don't.
    expect(windowsForceClash(a, b, 90, 30)).toBe(true);
  });

  it("treats a window shorter than its session as pinned to that window", () => {
    // B's stored slot is 30 minutes though it states 60, as a proposal that
    // predates painted availability might. It stays "only this time".
    expect(windowsForceClash(w("15:00", "16:00"), w("15:30", "16:00"), 60, 60)).toBe(true);
    expect(windowsForceClash(w("15:00", "17:00"), w("15:30", "16:00"), 60, 60)).toBe(false);
  });

  it("is a clash when one window is wholly inside the other", () => {
    // A needs three hours and only has the hour outside B's 30 minutes.
    expect(windowsForceClash(w("15:00", "18:00"), w("16:00", "16:30"), 180, 30)).toBe(true);
  });
});
describe("gridDays / gridWeeks", () => {
  it("lists every day of the range, both ends included", () => {
    expect(gridDays("2026-09-10", "2026-09-12")).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(gridDays("2026-09-10", "2026-09-10")).toEqual(["2026-09-10"]);
  });

  it("is empty for a range that runs backwards", () => {
    expect(gridDays("2026-09-12", "2026-09-10")).toEqual([]);
  });

  it("caps an absurd range instead of looping on it", () => {
    expect(gridDays("2026-01-01", "2126-01-01").length).toBe(366);
  });

  it("pages in weeks from the event's first day", () => {
    const weeks = gridWeeks(gridDays("2026-09-10", "2026-09-26"));
    expect(weeks.map((w) => w.length)).toEqual([7, 7, 3]);
    expect(weeks[1][0]).toBe("2026-09-17");
  });

  it("gives no pages for no days", () => {
    expect(gridWeeks([])).toEqual([]);
  });
});
