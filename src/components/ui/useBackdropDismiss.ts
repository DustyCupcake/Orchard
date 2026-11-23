import { useRef, type MouseEvent, type RefObject } from "react";

/** Is a click at (x, y) outside the box? The backdrop of a modal `<dialog>` reports clicks on the dialog itself, so position is the only way to tell backdrop from padding. */
export function isOutsideRect(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * Close a modal `<dialog>` when the dimmed backdrop is clicked.
 *
 * Both the press and the release must land outside the box, so selecting text
 * inside the dialog and letting go over the backdrop does not close it. Spread
 * the result onto the `<dialog>`. Clicks on children never count: their target
 * is not the dialog itself (this also keeps keyboard "clicks" on buttons, which
 * report 0,0, from closing it).
 */
export function useBackdropDismiss(ref: RefObject<HTMLDialogElement | null>, enabled = true) {
  const pressedOutside = useRef(false);
  const outside = (e: MouseEvent<HTMLDialogElement>) =>
    e.target === e.currentTarget && isOutsideRect(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  if (!enabled) return {};
  return {
    onMouseDown: (e: MouseEvent<HTMLDialogElement>) => {
      pressedOutside.current = outside(e);
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      const was = pressedOutside.current;
      pressedOutside.current = false;
      if (was && outside(e)) ref.current?.close();
    },
  };
}
