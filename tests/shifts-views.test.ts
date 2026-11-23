import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  NO_FILTERS,
  STANDING_SCOPE_KEY,
  addDaysToDay,
  assignLanes,
  calendarAxis,
  calendarWindowDays,
  clampWindowStart,
  clockOfOffset,
  daysPerPageForWidth,
  describeSeriesPattern,
  groupRowsBySeries,
  groupShiftsByDay,
  maxLanesForDays,
  offsetOfClock,
  orderScopes,
  parseTags,
  resolveScope,
  shiftDay,
  shiftMatchesFilters,
  shiftOffsets,
  shiftsByWindowDay,
  type ShiftScope,
  type ShiftViewRow,
} from "@/lib/shifts/views";

// One shift as the views render it. startTime/endTime drive the offsets the
// way the page derives them (minutes after the day's 06:00); an end at or
// before the start has crossed into the next calendar day.
function row(over: Partial<ShiftViewRow> & Pick<ShiftViewRow, "id" | "day">): ShiftViewRow {
  const startTime = over.startTime ?? "09:00";
  const endTime = over.endTime ?? "11:00";
  const startOffset = over.startOffset ?? offsetOfClock(startTime);
  let endOffset = over.endOffset ?? offsetOfClock(endTime);
  if (over.endOffset === undefined && endOffset <= startOffset) endOffset += 1440;
  return {
    seriesId: over.id,
    cycleId: null,
    title: "Cooking",
    description: null,
    branchId: null,
    branchName: null,
    tags: [],
    capacity: 3,
    signups: 0,
    startsAt: "2027-03-01T00:00:00Z",
    endsAt: "2027-03-01T00:00:00Z",
    when: "",
    iAmSignedUp: false,
    signupsOpen: true,
    actions: null,
    ...over,
    startTime,
    endTime,
    startOffset,
    endOffset,
  };
}

describe("shiftDay — the 6am–6am day", () => {
  it("puts a 00:30 start on the previous day", () => {
    expect(shiftDay("UTC", new Date("2027-03-06T00:30:00Z"))).toBe("2027-03-05");
  });
  it("puts a 05:59 start on the previous day", () => {
    expect(shiftDay("UTC", new Date("2027-03-06T05:59:00Z"))).toBe("2027-03-05");
  });
  it("puts a 06:00 start on its own day", () => {
    expect(shiftDay("UTC", new Date("2027-03-06T06:00:00Z"))).toBe("2027-03-06");
  });
  it("keeps an overnight start on its own day", () => {
    expect(shiftDay("UTC", new Date("2027-03-06T23:30:00Z"))).toBe("2027-03-06");
  });
  it("reads the zone's own clock (Madrid 05:30 = 04:30Z on Mar 6)", () => {
    expect(shiftDay("Europe/Madrid", new Date("2027-03-06T04:30:00Z"))).toBe("2027-03-05");
  });
});

describe("shiftOffsets — minutes after the day's 06:00", () => {
  it("measures a morning shift from 06:00", () => {
    expect(shiftOffsets("UTC", new Date("2027-03-06T09:00:00Z"), new Date("2027-03-06T11:00:00Z"))).toEqual({
      day: "2027-03-06",
      startOffset: 180,
      endOffset: 300,
    });
  });

  it("puts a 01:00 start on the previous day, past midnight", () => {
    expect(shiftOffsets("UTC", new Date("2027-03-06T01:00:00Z"), new Date("2027-03-06T02:30:00Z"))).toEqual({
      day: "2027-03-05",
      startOffset: 1140,
      endOffset: 1230,
    });
  });

  it("reads the venue's clock, not UTC (Madrid is UTC+1 in March)", () => {
    // 09:00 in Madrid on Mar 6 = 08:00Z.
    const o = shiftOffsets("Europe/Madrid", new Date("2027-03-06T08:00:00Z"), new Date("2027-03-06T10:00:00Z"));
    expect(o).toEqual({ day: "2027-03-06", startOffset: 180, endOffset: 300 });
  });
});

describe("clock offsets", () => {
  it("maps 06:00 to 0 and wraps the small hours after the evening", () => {
    expect(offsetOfClock("06:00")).toBe(0);
    expect(offsetOfClock("22:00")).toBe(960);
    expect(offsetOfClock("01:00")).toBe(1140);
  });
  it("round-trips through clockOfOffset", () => {
    for (const t of ["06:00", "09:30", "23:45", "00:00", "05:59"]) {
      expect(clockOfOffset(offsetOfClock(t))).toBe(t);
    }
  });
});

describe("shiftMatchesFilters", () => {
  const base = row({ id: "1", day: "2027-03-06", startTime: "09:00", endTime: "11:00", tags: ["cooking"], branchId: "b1" });

  it("matches when no filters are set", () => {
    expect(shiftMatchesFilters(base, NO_FILTERS)).toBe(true);
  });

  it("matches when the shift has any selected tag", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, tags: ["cooking"] })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, tags: ["cooking", "tidying"] })).toBe(true);
  });

  it("doesn't match when the shift has none of the selected tags", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, tags: ["tidying"] })).toBe(false);
  });

  it("matches the selected branch", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, branchId: "b1" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, branchId: "b2" })).toBe(false);
  });

  it("matches a From/To day range on the 6am–6am day", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, from: "2027-03-05" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, from: "2027-03-06" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, from: "2027-03-07" })).toBe(false);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, to: "2027-03-06" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, to: "2027-03-05" })).toBe(false);
  });

  it("matches a time filter when the shift overlaps the window", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeFrom: "08:30" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeFrom: "10:00" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeTo: "09:30" })).toBe(true);
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeFrom: "09:00", timeTo: "11:00" })).toBe(true);
  });

  it("doesn't match a shift that stops exactly where the window starts", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeFrom: "11:00" })).toBe(false);
  });

  it("doesn't match a shift that starts exactly where the window ends", () => {
    expect(shiftMatchesFilters(base, { ...NO_FILTERS, timeTo: "09:00" })).toBe(false);
  });

  it("doesn't match a shift sitting before or after the window", () => {
    const before = row({ id: "2", day: "2027-03-06", startTime: "08:00", endTime: "08:30" });
    expect(shiftMatchesFilters(before, { ...NO_FILTERS, timeFrom: "09:00" })).toBe(false);
    const after = row({ id: "3", day: "2027-03-06", startTime: "11:30", endTime: "12:00" });
    expect(shiftMatchesFilters(after, { ...NO_FILTERS, timeTo: "11:00" })).toBe(false);
  });

  it("keeps an overnight shift in a late window", () => {
    const late = row({ id: "4", day: "2027-03-06", startTime: "22:00", endTime: "01:00" });
    expect(shiftMatchesFilters(late, { ...NO_FILTERS, timeFrom: "23:00" })).toBe(true);
    expect(shiftMatchesFilters(late, { ...NO_FILTERS, timeFrom: "01:00" })).toBe(false);
  });

  it("sorts the small hours after the evening: a 02:00 shift is not 'before 09:00'", () => {
    const small = row({ id: "5", day: "2027-03-06", startTime: "02:00", endTime: "03:00" });
    expect(shiftMatchesFilters(small, { ...NO_FILTERS, timeTo: "09:00" })).toBe(false);
    expect(shiftMatchesFilters(small, { ...NO_FILTERS, timeFrom: "22:00" })).toBe(true);
  });

  it("reads a To of 06:00 as the end of the day", () => {
    const small = row({ id: "6", day: "2027-03-06", startTime: "02:00", endTime: "03:00" });
    expect(shiftMatchesFilters(small, { ...NO_FILTERS, timeTo: "06:00" })).toBe(true);
  });
});

describe("groupShiftsByDay", () => {
  const labels: Record<string, string> = { "2027-03-05": "Fri", "2027-03-06": "Sat" };

  it("groups in ascending day order and sorts each day by start", () => {
    const a = row({ id: "a", day: "2027-03-06", startsAt: "2027-03-06T10:00:00Z" });
    const b = row({ id: "b", day: "2027-03-05", startsAt: "2027-03-05T20:00:00Z" });
    const c = row({ id: "c", day: "2027-03-06", startsAt: "2027-03-06T09:00:00Z" });
    const groups = groupShiftsByDay([a, b, c], labels);
    expect(groups.map((g) => g.day)).toEqual(["2027-03-05", "2027-03-06"]);
    expect(groups[0].label).toBe("Fri");
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("reads the label from the day map and falls back to the bare day", () => {
    expect(groupShiftsByDay([row({ id: "x", day: "2027-03-05" })], labels)[0].label).toBe("Fri");
    expect(groupShiftsByDay([row({ id: "y", day: "2027-03-07" })], labels)[0].label).toBe("2027-03-07");
  });
});

describe("availableOnly", () => {
  const free = row({ id: "f", day: "2027-03-06", capacity: 3, signups: 2 });
  const full = row({ id: "g", day: "2027-03-06", capacity: 3, signups: 3 });
  it("starts on, with every other filter off", () => {
    expect(DEFAULT_FILTERS).toEqual({ ...NO_FILTERS, availableOnly: true });
  });
  it("keeps a shift with a free slot and hides a full one", () => {
    expect(shiftMatchesFilters(free, DEFAULT_FILTERS)).toBe(true);
    expect(shiftMatchesFilters(full, DEFAULT_FILTERS)).toBe(false);
  });
  it("keeps a full shift the viewer is signed up for, so they can withdraw", () => {
    expect(shiftMatchesFilters({ ...full, iAmSignedUp: true }, DEFAULT_FILTERS)).toBe(true);
  });
  it("shows full shifts when switched off", () => {
    expect(shiftMatchesFilters(full, NO_FILTERS)).toBe(true);
  });
});

describe("clampWindowStart", () => {
  const first = "2027-03-01";
  const last = "2027-03-05";
  it("leaves a page that fits alone", () => {
    expect(clampWindowStart("2027-03-02", 3, first, last)).toBe("2027-03-02");
  });
  it("pulls a page that would run past the last day back so it ends there", () => {
    expect(clampWindowStart("2027-03-04", 3, first, last)).toBe("2027-03-03");
    expect(clampWindowStart("2027-03-09", 3, first, last)).toBe("2027-03-03");
  });
  it("never starts before the first day", () => {
    expect(clampWindowStart("2027-02-25", 3, first, last)).toBe(first);
  });
  it("starts at the first day when there are fewer days than a page", () => {
    expect(clampWindowStart("2027-03-02", 3, "2027-03-01", "2027-03-02")).toBe("2027-03-01");
  });
  it("is the day itself for one column", () => {
    expect(clampWindowStart("2027-03-07", 1, first, last)).toBe(last);
  });
});

describe("calendarWindowDays", () => {
  it("shows the requested number of days from the start", () => {
    expect(calendarWindowDays("2027-03-06", 3)).toEqual(["2027-03-06", "2027-03-07", "2027-03-08"]);
    expect(calendarWindowDays("2027-03-06", 2)).toEqual(["2027-03-06", "2027-03-07"]);
    expect(calendarWindowDays("2027-03-06", 1)).toEqual(["2027-03-06"]);
  });

  it("rolls over month and year boundaries", () => {
    expect(calendarWindowDays("2027-03-31", 3)).toEqual(["2027-03-31", "2027-04-01", "2027-04-02"]);
    expect(calendarWindowDays("2027-12-31", 3)).toEqual(["2027-12-31", "2028-01-01", "2028-01-02"]);
  });
});

describe("daysPerPageForWidth and maxLanesForDays", () => {
  it("shows one day on a phone, two on a tablet, three on a desktop", () => {
    expect(daysPerPageForWidth(375)).toBe(1);
    expect(daysPerPageForWidth(639)).toBe(1);
    expect(daysPerPageForWidth(640)).toBe(2);
    expect(daysPerPageForWidth(1023)).toBe(2);
    expect(daysPerPageForWidth(1024)).toBe(3);
  });

  it("allows three lanes for a single day and two otherwise", () => {
    expect(maxLanesForDays(1)).toBe(3);
    expect(maxLanesForDays(2)).toBe(2);
    expect(maxLanesForDays(3)).toBe(2);
  });
});

describe("addDaysToDay", () => {
  it("adds days within a month", () => {
    expect(addDaysToDay("2027-03-06", 3)).toBe("2027-03-09");
    expect(addDaysToDay("2027-03-06", -3)).toBe("2027-03-03");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDaysToDay("2027-03-31", 1)).toBe("2027-04-01");
    expect(addDaysToDay("2027-12-31", 1)).toBe("2028-01-01");
  });
});

describe("shiftsByWindowDay", () => {
  it("buckets rows by their day when the day is in the window", () => {
    const inWindow = row({ id: "w", day: "2027-03-07" });
    const outWindow = row({ id: "o", day: "2027-03-05" });
    const byDay = shiftsByWindowDay([inWindow, outWindow], ["2027-03-06", "2027-03-07", "2027-03-08"]);
    expect([...byDay.keys()]).toEqual(["2027-03-07"]);
    expect(byDay.get("2027-03-07")?.map((r) => r.id)).toEqual(["w"]);
  });
});

describe("calendarAxis — one time-of-day axis for every column", () => {
  it("is null for no rows", () => {
    expect(calendarAxis([])).toBeNull();
  });

  it("spans the earliest start to the latest end across days, not across time", () => {
    // 09:00–10:00 on one day and 11:00–13:00 on another: the axis is 09:00–13:00,
    // however many days apart they are.
    const axis = calendarAxis([
      row({ id: "a", day: "2027-03-06", startTime: "09:00", endTime: "10:00" }),
      row({ id: "b", day: "2027-03-08", startTime: "11:00", endTime: "13:00" }),
    ]);
    expect(axis).toEqual({ fromOffset: 180, toOffset: 420 });
    expect(clockOfOffset(axis!.fromOffset)).toBe("09:00");
    expect(clockOfOffset(axis!.toOffset)).toBe("13:00");
  });

  it("widens to whole half-hours", () => {
    const axis = calendarAxis([row({ id: "a", day: "2027-03-06", startTime: "09:10", endTime: "10:20" })]);
    expect(clockOfOffset(axis!.fromOffset)).toBe("09:00");
    expect(clockOfOffset(axis!.toOffset)).toBe("10:30");
  });

  it("holds a shift that runs past the next 06:00 inside the day", () => {
    const axis = calendarAxis([row({ id: "a", day: "2027-03-06", startTime: "23:00", endTime: "07:00" })]);
    expect(axis!.toOffset).toBe(1440);
  });
});

describe("assignLanes", () => {
  const b = (id: string, start: number, end: number, order?: string) => ({ id, start, end, order });

  it("gives a lone block the whole width", () => {
    const { placements, chips } = assignLanes([b("a", 0, 60)], 3);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(chips).toEqual([]);
  });

  it("keeps back-to-back blocks full width (end == start is not overlap)", () => {
    const { placements } = assignLanes([b("a", 0, 60), b("b", 60, 120)], 3);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(placements.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts overlapping blocks side by side", () => {
    const { placements } = assignLanes([b("a", 0, 120, "A"), b("b", 60, 180, "B")], 3);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(placements.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("reuses a lane once it is free, and sizes lanes per cluster", () => {
    // a overlaps b; c starts after a ends but while b still runs — c reuses lane 0,
    // the cluster is still two lanes. d is alone later, so it is full width.
    const { placements } = assignLanes([b("a", 0, 60), b("b", 30, 150), b("c", 90, 120), b("d", 200, 260)], 3);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(placements.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(placements.get("c")).toEqual({ lane: 0, lanes: 2 });
    expect(placements.get("d")).toEqual({ lane: 0, lanes: 1 });
  });

  it("orders blocks that start together by the longer first, then by order", () => {
    const { placements } = assignLanes([b("x", 0, 60, "Bar"), b("y", 0, 120, "Door"), b("z", 0, 60, "Access")], 3);
    expect(placements.get("y")?.lane).toBe(0);
    expect(placements.get("z")?.lane).toBe(1);
    expect(placements.get("x")?.lane).toBe(2);
  });

  it("is deterministic whatever order the blocks arrive in", () => {
    const blocks = [b("a", 0, 120, "A"), b("b", 30, 90, "B"), b("c", 60, 150, "C")];
    const forward = assignLanes(blocks, 3).placements;
    const backward = assignLanes([...blocks].reverse(), 3).placements;
    for (const id of ["a", "b", "c"]) expect(backward.get(id)).toEqual(forward.get(id));
  });

  it("folds blocks beyond the lane cap into one chip in the last lane", () => {
    const blocks = [b("a", 0, 120), b("b", 0, 119), b("c", 0, 118), b("d", 10, 100)];
    const { placements, chips } = assignLanes(blocks, 3);
    expect([...placements.keys()].sort()).toEqual(["a", "b"]);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 3 });
    expect(placements.get("b")).toEqual({ lane: 1, lanes: 3 });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ lane: 2, lanes: 3, start: 0, end: 118 });
    expect(chips[0].ids.sort()).toEqual(["c", "d"]);
  });

  it("does not fold a cluster that fits exactly", () => {
    const { chips, placements } = assignLanes([b("a", 0, 60), b("b", 0, 60), b("c", 0, 60)], 3);
    expect(chips).toEqual([]);
    expect(placements.size).toBe(3);
  });

  it("never asks for fewer than two lanes", () => {
    const { placements, chips } = assignLanes([b("a", 0, 60), b("b", 0, 60), b("c", 0, 60)], 1);
    expect(placements.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(chips[0].lane).toBe(1);
  });
});

describe("parseTags", () => {
  it("parses the comma-separated form input", () => {
    expect(parseTags(" cooking , tidying ")).toEqual(["cooking", "tidying"]);
    expect(parseTags("cooking")).toEqual(["cooking"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags("cooking,")).toEqual(["cooking"]);
  });

  it("lowercases and de-duplicates so 'Cooking' and 'cooking' are one filter", () => {
    expect(parseTags("Cooking, cooking, COOKING, Tidying")).toEqual(["cooking", "tidying"]);
  });
});

describe("scopes", () => {
  const event = (key: string, label: string, nextStartsAt: string | null): ShiftScope => ({
    key,
    label,
    kind: "event",
    nextStartsAt,
  });
  const standing: ShiftScope = { key: STANDING_SCOPE_KEY, label: "Standing", kind: "standing", nextStartsAt: "2027-01-01T00:00:00Z" };
  const june = event("june", "June", "2027-06-10T00:00:00Z");
  const may = event("may", "May", "2027-05-10T00:00:00Z");
  const empty = event("empty", "Autumn", null);

  it("orders events by their next shift, empty ones after, Standing last", () => {
    expect(orderScopes([standing, empty, june, may]).map((s) => s.key)).toEqual(["may", "june", "empty", "standing"]);
  });

  it("shows the requested scope when it exists", () => {
    expect(resolveScope("june", [may, june, standing])?.key).toBe("june");
    expect(resolveScope(STANDING_SCOPE_KEY, [may, june, standing])?.key).toBe("standing");
  });

  it("defaults to the event whose next shift is soonest", () => {
    expect(resolveScope(undefined, [june, may, standing])?.key).toBe("may");
    expect(resolveScope("nonsense", [june, may, standing])?.key).toBe("may");
  });

  it("falls back to Standing when no event has an upcoming shift", () => {
    expect(resolveScope(undefined, [empty, standing])?.key).toBe("standing");
  });

  it("falls back to whatever is left, and to nothing when there is nothing", () => {
    expect(resolveScope(undefined, [empty])?.key).toBe("empty");
    expect(resolveScope(undefined, [])).toBeNull();
  });
});

describe("the standing schedule", () => {
  // 2027-03-02 is a Tuesday.
  const tue = (n: number, extra: Partial<ShiftViewRow> = {}) => {
    const day = addDaysToDay("2027-03-02", n);
    return row({ id: `t${n}`, seriesId: "s", day, startsAt: `${day}T18:00:00Z`, startTime: "18:00", endTime: "20:00", ...extra });
  };

  it("groups upcoming shifts by series, soonest series first, each soonest shift first", () => {
    const late = row({ id: "l1", seriesId: "late", title: "Late", day: "2027-03-09", startsAt: "2027-03-09T10:00:00Z" });
    const early2 = row({ id: "e2", seriesId: "early", title: "Early", day: "2027-03-10", startsAt: "2027-03-10T10:00:00Z" });
    const early1 = row({ id: "e1", seriesId: "early", title: "Early", day: "2027-03-03", startsAt: "2027-03-03T10:00:00Z" });
    const groups = groupRowsBySeries([late, early2, early1]);
    expect(groups.map((g) => g.seriesId)).toEqual(["early", "late"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["e1", "e2"]);
  });

  it("describes a weekly series", () => {
    expect(describeSeriesPattern([tue(0), tue(7), tue(14)])).toBe("Weekly on Tue · 18:00–20:00");
  });

  it("describes a fortnightly series", () => {
    expect(describeSeriesPattern([tue(0), tue(14), tue(28)])).toBe("Every other Tue · 18:00–20:00");
  });

  it("has no pattern for fewer than two shifts, uneven gaps or varying times", () => {
    expect(describeSeriesPattern([tue(0)])).toBeNull();
    expect(describeSeriesPattern([tue(0), tue(7), tue(21)])).toBeNull();
    expect(describeSeriesPattern([tue(0), tue(7, { startTime: "19:00" })])).toBeNull();
    expect(describeSeriesPattern([tue(0), tue(3)])).toBeNull();
  });
});
