import { describe, expect, it } from "vitest";
import { MENU_EDGE_PAD, MENU_GAP, placeMenu, type MenuAnchor, type MenuSize, type Viewport } from "@/lib/menu-placement";

// The bug this exists to rule out: on a phone the overflow menu opened
// with its rows off the side of the screen or below the fold, so the
// actions in it were visible-but-unreachable. These are the geometries
// where the old fixed `absolute right-0 top-8` anchor failed, asserted
// against the real screen sizes rather than a single synthetic one.

const MENU: MenuSize = { width: 208, height: 180 };

/** A trigger `size`-wide box whose top-left corner is at (x, y). */
function trigger(x: number, y: number, size = 28): MenuAnchor {
  return { top: y, bottom: y + size, left: x, right: x + size };
}

/** An iPhone SE — the narrowest screen this app is realistically opened on. */
const SE: Viewport = { width: 320, height: 568 };
/** An iPhone 15 — the common case. */
const PHONE: Viewport = { width: 393, height: 852 };
/** The desktop board layout, where the old anchor was always fine. */
const DESKTOP: Viewport = { width: 1180, height: 900 };

/**
 * True when the placed menu is entirely inside the viewport. `height` and
 * not `maxHeight`: `maxHeight` is the space on the chosen side of the
 * trigger, which for a menu placed above the trigger is measured upward
 * from the trigger rather than downward from the menu's own top.
 */
function fullyOnScreen(p: ReturnType<typeof placeMenu>, v: Viewport) {
  return p.left >= 0 && p.top >= 0 && p.left + p.width <= v.width && p.top + p.height <= v.height;
}

describe("popover placement", () => {
  it("opens below a desktop header trigger, right-aligned to it", () => {
    const anchor = trigger(1100, 100);
    const p = placeMenu(anchor, MENU, DESKTOP);

    expect(p.side).toBe("below");
    expect(p.top).toBe(anchor.bottom + MENU_GAP);
    expect(p.left).toBe(anchor.right - MENU.width);
    expect(fullyOnScreen(p, DESKTOP)).toBe(true);
  });

  it("keeps every row on screen when the trigger lands near the left edge", () => {
    // The reported bug: a header action row wraps on a narrow screen, the
    // trigger ends up near the left edge, and a right-aligned menu hangs
    // off the side of the screen with all of its rows unreachable.
    const anchor = trigger(24, 120);
    const p = placeMenu(anchor, MENU, SE);

    expect(p.left).toBeGreaterThanOrEqual(MENU_EDGE_PAD);
    expect(fullyOnScreen(p, SE)).toBe(true);
  });

  it("flips above a trigger near the bottom of the screen", () => {
    const anchor = trigger(300, 800);
    const p = placeMenu(anchor, MENU, PHONE);

    expect(p.side).toBe("above");
    expect(p.top + p.height).toBeLessThanOrEqual(anchor.top);
    expect(fullyOnScreen(p, PHONE)).toBe(true);
  });

  it("caps a menu too tall for either side and lets it scroll", () => {
    // The board's own action menu reaches nine rows in selection mode,
    // which fits neither side of a trigger near the middle of a phone.
    const tall: MenuSize = { width: 208, height: 500 };
    const anchor = trigger(300, 400);
    const p = placeMenu(anchor, tall, PHONE);

    expect(p.maxHeight).toBeLessThan(tall.height);
    expect(p.height).toBe(p.maxHeight);
    expect(fullyOnScreen(p, PHONE)).toBe(true);
  });

  it("narrows a menu too wide for the viewport rather than clamping it off-screen", () => {
    const anchor = trigger(0, 100);
    const p = placeMenu(anchor, MENU, { width: 200, height: 400 });

    expect(p.width).toBe(200 - 2 * MENU_EDGE_PAD);
    expect(p.left).toBe(MENU_EDGE_PAD);
    expect(fullyOnScreen(p, { width: 200, height: 400 })).toBe(true);
  });

  it("stays on screen and clear of the trigger across every position on a phone", () => {
    // The general guarantee, swept rather than spot-checked: no trigger
    // position on a real phone screen can put any of the menu's rows
    // somewhere unreachable, or cover the button that opened it.
    for (const v of [SE, PHONE]) {
      for (let x = 0; x <= v.width; x += 7) {
        for (let y = 0; y <= v.height; y += 37) {
          const anchor = trigger(x, y);
          const p = placeMenu(anchor, MENU, v);
          const where = `at (${x}, ${y}) on ${v.width}x${v.height}`;
          expect(fullyOnScreen(p, v), `off-screen ${where}`).toBe(true);
          const overlaps =
            p.left < anchor.right && p.left + p.width > anchor.left && p.top < anchor.bottom && p.top + p.height > anchor.top;
          expect(overlaps, `covers its own trigger ${where}`).toBe(false);
        }
      }
    }
  });
});
