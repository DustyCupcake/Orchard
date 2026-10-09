import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  effectiveTimeZone,
  formatInstant,
  formatInstantRange,
  formatTimeInZone,
  instantFromZoned,
  isValidTimeZone,
  localDateInZone,
  localInputFromInstant,
} from "@/lib/dates";

// No database. These are the wall-clock <-> instant conversions every
// programme slot on /schedule goes through: the editor converts what a
// member typed, and the read side converts back. Getting either wrong
// shifts an event's programme by an hour with no error anywhere, so the
// offsets are asserted against values worked out by hand rather than
// against the implementation's own output.

describe("isValidTimeZone", () => {
  it("accepts real IANA names", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
  });

  it("rejects anything else, rather than storing a zone that reads as UTC", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("Europe/Londn")).toBe(false);
    // A zone that happens to parse as GMT but isn't one.
    expect(isValidTimeZone("GMT+2")).toBe(false);
  });
});

describe("effectiveTimeZone", () => {
  it("prefers the event's own zone", () => {
    expect(effectiveTimeZone({ timeZone: "Asia/Tokyo" }, { timeZone: "Europe/Berlin" })).toBe("Asia/Tokyo");
  });

  it("falls back to the Community's when the event has none", () => {
    expect(effectiveTimeZone({ timeZone: null }, { timeZone: "Europe/Berlin" })).toBe("Europe/Berlin");
    expect(effectiveTimeZone(null, { timeZone: "Europe/Berlin" })).toBe("Europe/Berlin");
  });

  it("is UTC when neither is set", () => {
    expect(effectiveTimeZone(null, {})).toBe(DEFAULT_TIME_ZONE);
    expect(effectiveTimeZone({ timeZone: null }, { timeZone: null })).toBe("UTC");
  });

  // A zone can stop being valid after it was stored — an IANA rename, or
  // a runtime whose tzdata is older than the value. That shouldn't make
  // a Community's programme unreadable, so an unusable event zone skips
  // to the Community's rather than throwing.
  it("skips a zone this runtime doesn't know rather than failing", () => {
    expect(effectiveTimeZone({ timeZone: "Mars/Olympus" }, { timeZone: "Europe/Berlin" })).toBe("Europe/Berlin");
    expect(effectiveTimeZone({ timeZone: "Mars/Olympus" }, { timeZone: "Nowhere" })).toBe("UTC");
  });
});

describe("reading an instant as a wall clock", () => {
  it("uses the given zone, not the host's", () => {
    // The same instant is three different local dates depending on who
    // is asking — which is the whole reason the programme carries a zone.
    const instant = "2026-09-10T23:00:00.000Z";
    expect(localDateInZone(instant, "UTC")).toBe("2026-09-10");
    expect(localDateInZone(instant, "Pacific/Auckland")).toBe("2026-09-11");
    expect(localDateInZone(instant, "Pacific/Honolulu")).toBe("2026-09-10");
  });

  it("shifts by the zone's offset, including a half-hour one", () => {
    expect(formatTimeInZone("2026-09-10T18:20:00.000Z", "Asia/Kathmandu")).toBe("00:05");
    expect(localDateInZone("2026-09-10T18:20:00.000Z", "Asia/Kathmandu")).toBe("2026-09-11");
    expect(formatTimeInZone("2026-09-11T02:30:00.000Z", "America/New_York")).toBe("22:30");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // Sydney is +11 in January, +10 in July.
    expect(formatTimeInZone("2026-01-15T00:00:00.000Z", "Australia/Sydney")).toBe("11:00");
    expect(formatTimeInZone("2026-07-15T00:00:00.000Z", "Australia/Sydney")).toBe("10:00");
  });

  // hourCycle: "h23" rather than hour12:false, which renders midnight as
  // hour 24 — a midnight slot would then read back as 23:00 on the day
  // before.
  it("reads midnight as 00:00, not 24:00", () => {
    expect(formatTimeInZone("2026-09-10T00:00:00.000Z", "UTC")).toBe("00:00");
    expect(formatTimeInZone("2026-09-09T15:00:00.000Z", "Asia/Tokyo")).toBe("00:00");
    expect(localDateInZone("2026-09-09T15:00:00.000Z", "Asia/Tokyo")).toBe("2026-09-10");
    expect(localInputFromInstant("2026-09-09T15:00:00.000Z", "Asia/Tokyo")).toBe("2026-09-10T00:00");
  });
});

describe("instantFromZoned", () => {
  it("resolves a wall clock to the instant it names", () => {
    expect(instantFromZoned("2026-09-10T14:00", "UTC").toISOString()).toBe("2026-09-10T14:00:00.000Z");
    expect(instantFromZoned("2026-09-10T22:30", "America/New_York").toISOString()).toBe("2026-09-11T02:30:00.000Z");
    expect(instantFromZoned("2026-09-11T00:05", "Asia/Kathmandu").toISOString()).toBe("2026-09-10T18:20:00.000Z");
  });

  // The offset depends on the instant and the instant depends on the
  // offset, so the first guess is wrong near a DST transition. The
  // second pass is what settles these.
  it("resolves the hours either side of a spring-forward correctly", () => {
    // US clocks jump 02:00 -> 03:00 on 2026-03-08.
    expect(instantFromZoned("2026-03-08T01:30", "America/New_York").toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(instantFromZoned("2026-03-08T03:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // EU clocks jump 02:00 -> 03:00 on 2026-03-29.
    expect(instantFromZoned("2026-03-29T01:30", "Europe/Madrid").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(instantFromZoned("2026-03-29T03:30", "Europe/Madrid").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("resolves the repeated hour of an autumn-back morning", () => {
    // 02:30 happens twice on 2026-10-25 in Madrid; the earlier one is
    // the still-summer reading, which is what the first offset read
    // gives.
    expect(instantFromZoned("2026-10-25T02:30", "Europe/Madrid").toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("round-trips through localInputFromInstant for ordinary wall clocks", () => {
    for (const zone of [
      "UTC",
      "Europe/London",
      "Asia/Kathmandu",
      "America/St_Johns",
      "Pacific/Chatham",
      "Pacific/Apia",
      "Australia/Sydney",
      "America/New_York",
    ]) {
      for (const wall of ["2026-09-10T14:00", "2026-01-15T09:30", "2026-06-01T23:45", "2026-11-01T01:15"]) {
        const iso = instantFromZoned(wall, zone).toISOString();
        expect(localInputFromInstant(iso, zone)).toBe(wall);
      }
    }
  });

  it("refuses anything that isn't a datetime-local value", () => {
    expect(() => instantFromZoned("not a time", "UTC")).toThrow();
    expect(() => instantFromZoned("", "UTC")).toThrow();
    // An instant, not a wall clock — passing one of these in is the bug
    // this whole conversion exists to prevent.
    expect(() => instantFromZoned("2026-09-10T14:00:00.000Z", "UTC")).toThrow();
  });
});
describe("formatInstant", () => {
  const at = "2026-10-09T23:30:00.000Z";

  it("reads the same instant on whichever clock it is given", () => {
    expect(formatInstant(at, "UTC")).toBe("Oct 9, 2026, 23:30");
    expect(formatInstant(at, "Asia/Tokyo")).toBe("Oct 10, 2026, 08:30");
    expect(formatInstant(at, "America/Los_Angeles")).toBe("Oct 9, 2026, 16:30");
  });

  it("writes just the date or just the time", () => {
    expect(formatInstant(at, "Asia/Tokyo", "date")).toBe("Oct 10, 2026");
    expect(formatInstant(at, "Asia/Tokyo", "time")).toBe("08:30");
  });

  it("can carry the zone, for a deadline read on someone else's clock", () => {
    expect(formatInstant(at, "America/Los_Angeles", "datetime", { zoneName: true })).toMatch(/16:30 (PDT|GMT-7)$/);
  });

  it("reads midnight as 00:00, not 24:00", () => {
    expect(formatInstant("2026-10-09T00:00:00.000Z", "UTC", "time")).toBe("00:00");
  });

  it("falls back to UTC for an unusable zone rather than throwing", () => {
    expect(formatInstant(at, "Not/AZone")).toBe("Oct 9, 2026, 23:30");
  });

  it("writes a range once, and spells out both ends across midnight", () => {
    expect(formatInstantRange("2026-10-09T14:00:00Z", "2026-10-09T15:30:00Z", "UTC")).toBe("Oct 9, 2026, 14:00–15:30");
    expect(formatInstantRange("2026-10-09T23:00:00Z", "2026-10-10T01:00:00Z", "UTC")).toBe(
      "Oct 9, 2026, 23:00–Oct 10, 2026, 01:00",
    );
    // The same pair on a clock where it no longer crosses midnight.
    expect(formatInstantRange("2026-10-09T23:00:00Z", "2026-10-10T01:00:00Z", "Asia/Tokyo")).toBe(
      "Oct 10, 2026, 08:00–10:00",
    );
  });
});
