import { describe, expect, it } from "vitest";
import { parseAskField, toDatetimeLocal } from "@/app/(app)/[cycleScope]/budget/format";
import { updateBudgetCycleInput } from "@/lib/budget";

// The budget edit screen posts the ask alongside title, fixed costs and
// deadline. These pin how that field is read, since "not submitted" (leave the
// ask alone) and "emptied" (clear it) must stay different things.
describe("parseAskField", () => {
  it("is undefined when the field wasn't submitted, so the ask is left alone", () => {
    expect(parseAskField(null)).toBeUndefined();
  });

  it("is null when the field was emptied, so the ask is cleared", () => {
    expect(parseAskField("")).toBeNull();
    expect(parseAskField("   ")).toBeNull();
  });

  it("is the number typed", () => {
    expect(parseAskField("25")).toBe(25);
    expect(parseAskField(" 0 ")).toBe(0);
  });

  it("passes a bad value through for the schema to refuse", () => {
    const fractional = parseAskField("2.5");
    const negative = parseAskField("-3");
    const junk = parseAskField("abc");
    expect(updateBudgetCycleInput.safeParse({ contributionPerMember: fractional }).success).toBe(false);
    expect(updateBudgetCycleInput.safeParse({ contributionPerMember: negative }).success).toBe(false);
    expect(updateBudgetCycleInput.safeParse({ contributionPerMember: junk }).success).toBe(false);
    expect(updateBudgetCycleInput.safeParse({ contributionPerMember: parseAskField("25") }).success).toBe(true);
    expect(updateBudgetCycleInput.safeParse({ contributionPerMember: parseAskField("") }).success).toBe(true);
  });
});

describe("toDatetimeLocal", () => {
  it("fills the field on the event's clock, not the server's", () => {
    const instant = new Date("2026-07-01T10:30:00Z");
    expect(toDatetimeLocal(instant, "UTC")).toBe("2026-07-01T10:30");
    expect(toDatetimeLocal(instant, "Europe/Brussels")).toBe("2026-07-01T12:30");
  });
});
