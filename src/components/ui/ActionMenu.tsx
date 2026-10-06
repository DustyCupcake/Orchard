"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { MENU_EDGE_PAD, placeMenu } from "@/lib/menu-placement";

// The task-UI grammar's one overflow menu (docs/design_handoff_conventions/
// README.md — "Action hierarchy"). A real client dropdown — the single
// place this codebase uses one; `<details>` stays the pattern for edit
// disclosures. Children are the menu rows: server-action <form>s or
// <Link>s passed in from a Server Component, each rendered full-width
// via the wrapper's CSS. Closes on outside click and Escape.
//
// Positioned from measured geometry (`position: fixed` plus coordinates
// from `placeMenu`) rather than a CSS anchor. A `absolute right-0 top-8`
// anchor is only correct while the trigger happens to be far enough from
// the left edge and high enough on the screen, and on a phone neither
// holds — the menu's rows went off the side of the screen or below the
// fold, and either way the actions in it were unreachable. See
// src/lib/menu-placement.ts for the placement rules.
export default function ActionMenu({ children, label = "More actions" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Measures, then writes the position straight to the element rather
  // than through state: the menu's own size feeds back into the
  // calculation, so routing it through a render would need the numbers
  // applied before they are known. The natural size is re-read every time
  // with the previous width and cap cleared first, otherwise a menu that
  // had been narrowed or capped last time would only ever stay that way —
  // including after a rotation that left plenty of room again.
  const place = useCallback(() => {
    const anchor = buttonRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    menu.style.width = "";
    menu.style.maxHeight = "";
    const natural = menu.getBoundingClientRect();
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };

    // Applied before the final measurement, not after: a menu narrowed to
    // fit a narrow screen wraps its rows onto extra lines, so measuring it
    // at its wide-but-capped height would place it against a height it no
    // longer has. Near-unreachable in practice — a phone narrower than a
    // `w-52` menu plus its edge padding — but it's the same code path.
    const width = Math.min(natural.width, viewport.width - 2 * MENU_EDGE_PAD);
    if (width !== natural.width) menu.style.width = `${width}px`;

    const sized = menu.getBoundingClientRect();
    const placement = placeMenu(
      anchor.getBoundingClientRect(),
      { width: sized.width, height: sized.height },
      viewport,
    );

    menu.style.left = `${placement.left}px`;
    menu.style.top = `${placement.top}px`;
    menu.style.maxHeight = `${placement.maxHeight}px`;
  }, []);

  // A layout effect, not a passive one: the menu must never paint at an
  // unpositioned origin first, which on a phone is the difference between
  // a menu that appears under the finger and one that visibly jumps.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Re-placed on scroll as well as resize, because a `position: fixed`
    // menu stays put while the anchor moves under it. `true` for the
    // capture phase: the trigger can sit inside any scrollable ancestor —
    // the sidebar nav, a card list — and those don't bubble to `window`.
    // A scroll also covers iOS collapsing its toolbar, which is what
    // finally makes a menu near the bottom of a phone screen fit.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--text)]"
      >
        <DotsThreeIcon size={16} weight="bold" />
      </button>
      {open && (
        // The scroller, so a menu too tall for the space it opened into
        // stays fully reachable instead of running off the screen. Its
        // own `overscroll-contain` stops that scroll from chaining on to
        // the page behind it, which on a touch device is otherwise an
        // easy way to lose the menu you were reading.
        <div
          ref={menuRef}
          role="menu"
          onClick={() => {
            // Rows are server-action <form>s (Release, escalate, …) and
            // <Link>s passed in from a Server Component. Closing here
            // synchronously would unmount the clicked row — and its
            // <form> — before the click's default action (the form
            // submission) can run, silently swallowing the action. Defer
            // the close to the next task so the submission starts first;
            // the menu still collapses right after, and the page the
            // action revalidates/redirects to replaces it anyway.
            setTimeout(() => setOpen(false), 0);
          }}
          // `z-50`, not the `z-20` the old absolutely-positioned menu used.
          // `position: fixed` is no longer contained by the page, so the
          // menu now competes with the shell's own fixed layers — and
          // `z-20` is the desktop sidebar's, which is exactly the layer a
          // phone-sized menu must not disappear behind.
          className="fixed z-50 flex w-52 flex-col overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md,0_4px_14px_rgba(0,0,0,0.08))]"
        >
          {/* A second box, because the scroller above can't also be the
              thing that clips the rows to the rounded corners — a hovered
              first or last row would otherwise square off the corner it
              overlaps. */}
          <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] [&_button]:w-full [&_button]:rounded-none [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:text-left [&_button]:text-[length:var(--text-body)] [&_button]:text-[var(--text)] [&_button]:hover:bg-[var(--surface-sunken)] [&_a]:block [&_a]:px-3 [&_a]:py-2 [&_a]:text-[length:var(--text-body)] [&_a]:text-[var(--text)] [&_a]:hover:bg-[var(--surface-sunken)]">
            {children}
          </div>
        </div>
      )}
    </span>
  );
}
