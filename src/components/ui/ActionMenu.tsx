"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react";

// The task-UI grammar's one overflow menu (docs/design_handoff_conventions/
// README.md — "Action hierarchy"). A real client dropdown — the single
// place this codebase uses one; `<details>` stays the pattern for edit
// disclosures. Children are the menu rows: server-action <form>s or
// <Link>s passed in from a Server Component, each rendered full-width
// via the wrapper's CSS. Closes on outside click and Escape.
export default function ActionMenu({ children, label = "More actions" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

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
        <div
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
          className="absolute right-0 top-8 z-20 flex w-52 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md,0_4px_14px_rgba(0,0,0,0.08))] [&_button]:w-full [&_button]:rounded-none [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:text-left [&_button]:text-[13px] [&_button]:text-[var(--text)] [&_button]:hover:bg-[var(--surface-sunken)] [&_a]:block [&_a]:px-3 [&_a]:py-2 [&_a]:text-[13px] [&_a]:text-[var(--text)] [&_a]:hover:bg-[var(--surface-sunken)]"
        >
          {children}
        </div>
      )}
    </span>
  );
}
