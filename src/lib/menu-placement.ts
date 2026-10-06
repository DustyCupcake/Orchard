// Where a popover has to sit so that all of it is reachable.
//
// This exists because anchoring a menu in CSS alone (`absolute right-0
// top-8`, which is what ActionMenu used to do) silently assumes the
// trigger sits somewhere the menu fits around it. That holds on a wide
// desktop layout and fails on a phone in two separate ways, both of which
// need a measurement to detect:
//
//   - Horizontally, `right-0` pins the menu's right edge to the trigger's
//     right edge, which is only ever safe if that edge is at least a
//     menu-width from the left of the screen. On a narrow viewport the
//     header's action row wraps, so the trigger can land near the left
//     edge and the menu's rows go off the side of the screen — the menu
//     opens and appears to be empty, because everything in it is clipped
//     rather than absent.
//   - Vertically, a menu that opens downward from a trigger near the
//     bottom of the screen simply runs out of screen. Nothing scrolls it
//     into reach, so the bottom rows are unreachable. On a phone this is
//     the common case, not an edge case: the board's own action menu
//     reaches nine rows in selection mode.
//
// The fix is the same arithmetic a native popover does: measure the
// trigger and the menu, then place the menu in whichever of the four
// candidate positions is fully on screen, clamping to the viewport edge
// where no position is. Where the space is short in the chosen direction,
// `maxHeight` caps it and the menu scrolls inside that cap rather than
// hanging off the edge — so a menu can never be positioned where its own
// contents are unreachable.

/** The clear space between the trigger and the menu, on the open side. */
export const MENU_GAP = 4;

/**
 * The clear space kept between the menu and every viewport edge. A menu
 * flush to the very edge of the screen reads as a rendering fault, and on
 * a touch device it leaves nothing to aim a fingertip at.
 */
export const MENU_EDGE_PAD = 8;

export type MenuAnchor = { top: number; bottom: number; left: number; right: number };
export type MenuSize = { width: number; height: number };
export type Viewport = { width: number; height: number };

/** Which side of the trigger the menu landed on. */
export type MenuSide = "below" | "above";

export type MenuPlacement = MenuSize & {
  /** Offset from the viewport's left edge, for a `position: fixed` menu. */
  left: number;
  /** Offset from the viewport's top edge, for a `position: fixed` menu. */
  top: number;
  /** The menu's natural height, capped to the space available. */
  maxHeight: number;
  side: MenuSide;
};

/**
 * Places a menu of `menu`'s natural size against `anchor` inside
 * `viewport`, choosing the position that keeps all of it on screen.
 *
 * Vertical: below the trigger unless that would push the menu off the
 * bottom and there is more room above than below. `maxHeight` is the
 * space on the chosen side, so a menu too tall for either side is capped
 * to the larger of the two and scrolls rather than being clipped.
 *
 * Horizontal: right-aligned to the trigger, because the trigger is
 * almost always at the right of an action row and a right-aligned menu
 * is what the eye expects to slide out of it — then clamped into the
 * viewport. A menu wider than the viewport itself is narrowed to fit
 * instead, because narrowing lets the rows wrap while clamping cannot.
 */
export function placeMenu(anchor: MenuAnchor, menu: MenuSize, viewport: Viewport): MenuPlacement {
  const spaceBelow = viewport.height - anchor.bottom - MENU_GAP - MENU_EDGE_PAD;
  const spaceAbove = anchor.top - MENU_GAP - MENU_EDGE_PAD;
  const side: MenuSide = spaceBelow >= menu.height || spaceBelow >= spaceAbove ? "below" : "above";
  const maxHeight = Math.max(0, side === "below" ? spaceBelow : spaceAbove);

  const width = Math.min(menu.width, viewport.width - 2 * MENU_EDGE_PAD);
  const height = Math.min(menu.height, maxHeight);

  // The upper clamp can't push this below MENU_EDGE_PAD, because `width`
  // is itself at most `viewport.width - 2 * MENU_EDGE_PAD` — which is
  // what makes the width narrowing above load-bearing rather than a
  // separate concern.
  const left = Math.min(
    Math.max(anchor.right - width, MENU_EDGE_PAD),
    viewport.width - MENU_EDGE_PAD - width,
  );

  return {
    left,
    top:
      side === "below"
        ? anchor.bottom + MENU_GAP
        : Math.max(MENU_EDGE_PAD, anchor.top - MENU_GAP - height),
    width,
    height,
    maxHeight,
    side,
  };
}
