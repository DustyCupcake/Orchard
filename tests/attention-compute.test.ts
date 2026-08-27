import { describe, expect, it } from "vitest";
import { computeAttentionLevel, type TaskAttentionInput } from "@/lib/attention";

const NOW = new Date("2026-06-15T12:00:00Z");
const THRESHOLDS = { softDays: 7, hardDays: 14 };

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

const base: TaskAttentionInput = {
  status: "unclaimed",
  critical: false,
  createdAt: NOW,
  statusChangedAt: NOW,
  nextCheckinAt: null,
  unblocked: true,
  phaseEndDate: null,
};

describe("computeAttentionLevel", () => {
  it("a done task is always ok", () => {
    expect(
      computeAttentionLevel({ ...base, status: "done", createdAt: daysAgo(90) }, THRESHOLDS, NOW),
    ).toBe("ok");
  });

  it("a blocked task stays ok no matter how old", () => {
    expect(
      computeAttentionLevel(
        { ...base, unblocked: false, createdAt: daysAgo(90) },
        THRESHOLDS,
        NOW,
      ),
    ).toBe("ok");
  });

  describe("staleness (unclaimed, measured from createdAt)", () => {
    it("under the soft threshold is ok", () => {
      expect(computeAttentionLevel({ ...base, createdAt: daysAgo(3) }, THRESHOLDS, NOW)).toBe(
        "ok",
      );
    });

    it("past the soft threshold, under hard, is soft", () => {
      expect(computeAttentionLevel({ ...base, createdAt: daysAgo(8) }, THRESHOLDS, NOW)).toBe(
        "soft",
      );
    });

    it("past the hard threshold is hard", () => {
      expect(computeAttentionLevel({ ...base, createdAt: daysAgo(15) }, THRESHOLDS, NOW)).toBe(
        "hard",
      );
    });
  });

  describe("staleness (claimed, measured from statusChangedAt)", () => {
    it("uses statusChangedAt rather than createdAt", () => {
      const input: TaskAttentionInput = {
        ...base,
        status: "claimed",
        createdAt: daysAgo(90),
        statusChangedAt: daysAgo(2),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("ok");
    });

    it("still escalates soft/hard once inactive long enough", () => {
      const input: TaskAttentionInput = {
        ...base,
        status: "claimed",
        createdAt: daysAgo(90),
        statusChangedAt: daysAgo(20),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("hard");
    });
  });

  describe("critical + unclaimed: skips soft, jumps straight to hard", () => {
    it("stays ok before the hard threshold, even past the soft one", () => {
      const input: TaskAttentionInput = { ...base, critical: true, createdAt: daysAgo(10) };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("ok");
    });

    it("jumps to hard once past the hard threshold", () => {
      const input: TaskAttentionInput = { ...base, critical: true, createdAt: daysAgo(15) };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("hard");
    });

    it("does not apply once the task is claimed — normal soft/hard progression instead", () => {
      const input: TaskAttentionInput = {
        ...base,
        status: "claimed",
        critical: true,
        statusChangedAt: daysAgo(10),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("soft");
    });
  });

  describe("phase-based (only relevant when the caller passes a phaseEndDate)", () => {
    it("a passed phase end date forces hard even on a brand-new task", () => {
      const input: TaskAttentionInput = {
        ...base,
        createdAt: NOW,
        phaseEndDate: daysAgo(1),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("hard");
    });

    it("a future phase end date doesn't trigger anything on its own", () => {
      const input: TaskAttentionInput = {
        ...base,
        createdAt: NOW,
        phaseEndDate: new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("ok");
    });
  });

  describe("waiting (measured from nextCheckinAt, softDays as the grace period)", () => {
    it("no check-in date set is ok", () => {
      expect(computeAttentionLevel({ ...base, status: "waiting" }, THRESHOLDS, NOW)).toBe("ok");
    });

    it("a check-in date still in the future is ok", () => {
      const input: TaskAttentionInput = {
        ...base,
        status: "waiting",
        nextCheckinAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("ok");
    });

    it("just past the check-in date, within the grace period, is soft", () => {
      const input: TaskAttentionInput = { ...base, status: "waiting", nextCheckinAt: daysAgo(2) };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("soft");
    });

    it("past the check-in date beyond the grace period is hard", () => {
      const input: TaskAttentionInput = { ...base, status: "waiting", nextCheckinAt: daysAgo(10) };
      expect(computeAttentionLevel(input, THRESHOLDS, NOW)).toBe("hard");
    });
  });
});
