"use client";

import { useRef, type ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react";

/**
 * A native `<dialog>` in a modal, with the content passed in as children.
 *
 * Why native rather than a div with `position: fixed`: it gives Escape to
 * close, the focus trap, the inert background, and the right ARIA semantics
 * without any of it being hand-written, and it is the difference between a
 * dialog that behaves correctly for keyboard and screen-reader users on the
 * first try and one that does not. `showModal()` is one call and `close()` is
 * one call; the whole component is the ref and two handlers.
 *
 * Children are server-rendered and passed through untouched, so a caller in
 * a Server Component can put real `<form action={serverAction}>`s inside.
 * The `type="button"` on the trigger and the close control is load-bearing
 * for the same reason it was in `LaneEditorControls`' Button — a bare
 * `<button>` inside a form submits it.
 */
export default function Modal({
  trigger,
  triggerClassName,
  title,
  description,
  children,
  wide = false,
}: {
  /** Label on the button that opens the dialog. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** A real heading, referenced by aria-labelledby. */
  title: string;
  /** Optional line under the title, inside the dialog rather than on the page. */
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="modal-title"
        className={`m-auto w-[calc(100vw-2rem)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--text)] shadow-[var(--shadow-md,0_4px_14px_rgba(0,0,0,0.08))] backdrop:bg-black/40 ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="modal-title" className="text-[length:var(--text-heading)] font-medium">
              {title}
            </h2>
            {description && (
              <p className="mt-1 max-w-[520px] text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-m-1 shrink-0 rounded-[var(--radius-md)] p-1 text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--text)]"
          >
            <XIcon size={16} weight="bold" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </dialog>
    </>
  );
}
