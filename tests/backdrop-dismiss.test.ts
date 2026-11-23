import { describe, expect, it } from "vitest";
import { isOutsideRect } from "@/components/ui/useBackdropDismiss";

const rect = { left: 100, right: 500, top: 50, bottom: 350 };

describe("isOutsideRect", () => {
  it("is inside on the box, its edges and its padding", () => {
    expect(isOutsideRect(300, 200, rect)).toBe(false);
    expect(isOutsideRect(100, 50, rect)).toBe(false);
    expect(isOutsideRect(500, 350, rect)).toBe(false);
  });
  it("is outside past any edge", () => {
    expect(isOutsideRect(99, 200, rect)).toBe(true);
    expect(isOutsideRect(501, 200, rect)).toBe(true);
    expect(isOutsideRect(300, 49, rect)).toBe(true);
    expect(isOutsideRect(300, 351, rect)).toBe(true);
  });
  it("treats a keyboard-triggered click at 0,0 as outside, which is why the hook also requires the dialog itself as target", () => {
    expect(isOutsideRect(0, 0, rect)).toBe(true);
  });
});
