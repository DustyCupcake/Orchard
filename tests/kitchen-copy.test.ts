import { describe, expect, it } from "vitest";
import { KITCHEN_SIGNALS } from "@/db/schema";
import {
  answerShapeLabel,
  kitchenPanelSummary,
  kitchenSetUpCount,
} from "../src/app/(app)/settings/kitchen-copy";

describe("kitchen question copy", () => {
  const total = KITCHEN_SIGNALS.length;

  it("counts out of however many signals the kitchen has, not a fixed number", () => {
    // One unwired of four is "3 of 4" — it said "2 of 3" when this was hardcoded.
    expect(kitchenSetUpCount(1)).toBe(`${total - 1} of ${total}`);
    expect(kitchenSetUpCount(total)).toBe("none");
    expect(kitchenSetUpCount(0)).toBe(`${total} of ${total}`);
  });

  it("says how many are left in the panel, out of the real total", () => {
    expect(kitchenPanelSummary(1)).toContain(`1 of ${total} aren't set up yet`);
    expect(kitchenPanelSummary(0)).toMatch(/^All of them are set up/);
  });

  it("names a single-choice question as pick one, not a written answer", () => {
    expect(answerShapeLabel("single_choice")).toBe("pick one");
    expect(answerShapeLabel("multi_choice")).toBe("pick any");
    expect(answerShapeLabel("text")).toBe("written answer");
  });
});
