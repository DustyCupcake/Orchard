"use client";

import { useRef, type ReactNode } from "react";

/**
 * The coordinator self-assign ask, as a dialog the Claim button opens.
 *
 * The rule itself is unchanged and still enforced server-side by
 * `claimOrRequestToJoin` (docs/spec.md's Coordination mechanics: "when
 * anyone with placement authority tries to self-assign a flagged or
 * unclaimed task: 'Are you sure there isn't someone with just the skills
 * for this?'"). What changed is *when* it surfaces. It used to be a
 * client-side predicate that deleted the Claim button and put a
 * permanent banner in its place, so a coordinator saw the question on
 * every unclaimed or flagged task in their scope whether or not they
 * were trying to claim anything. Now Claim stays an ordinary button and
 * the question is what clicking it opens.
 *
 * A native `<dialog>` rather than a div overlay, for Escape, the focus
 * trap, inert background and correct ARIA semantics without hand-writing
 * any of it — the same reasoning as `Modal.tsx`. What Modal doesn't do
 * is let the dialog close once one of several nested forms has submitted:
 * it composes static children, whereas here submitting has to dismiss
 * the dialog so the revalidating page isn't left rendering behind an open
 * one.
 */
export default function ClaimGate({
  taskId,
  claimLabel,
  gated,
  confirmClaimAction,
  alternatives,
  flagForm,
}: {
  taskId: string;
  /** Text on the button — the plain Claim button's text when ungated. */
  claimLabel: string;
  /**
   * Whether this particular claim needs the ask: the actor coordinates
   * this task's scope *and* the task is unclaimed or attention-flagged —
   * exactly the two conditions `claimOrRequestToJoin` re-checks
   * server-side. False renders an ordinary Claim button with no dialog.
   */
  gated: boolean;
  /** The claim itself, already past the gate (the `confirmed` path). */
  confirmClaimAction: (formData: FormData) => void | Promise<void>;
  /**
   * The other options, server-rendered by the caller so they can be real
   * `<form action={...}>`s over the app's Server Actions.
   */
  alternatives?: ReactNode;
  /**
   * "Flag it for the group" — spec's own third option, which escalates
   * the task onto the shared Escalation queue every coordinator sees.
   * Kept separate from `alternatives` only because the task page passes
   * it unconditionally while the ask-someone form is conditional on the
   * caller being authorized to nominate. Either would do as a single node.
   */
  flagForm?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  if (!gated) {
    return (
      <form action={confirmClaimAction}>
        <input type="hidden" name="taskId" value={taskId} />
        <button
          type="submit"
          className="rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)] active:bg-[var(--accent-1-active)]"
        >
          {claimLabel}
        </button>
      </form>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)] active:bg-[var(--accent-1-active)]"
      >
        {claimLabel}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="claim-gate-title"
        className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--text)] shadow-[var(--shadow-md,0_4px_14px_rgba(0,0,0,0.08))] backdrop:bg-black/40"
      >
        <h2 id="claim-gate-title" className="text-[15px] font-medium">
          Are you sure there isn&rsquo;t someone with just the skills for this?
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          You coordinate this one, so it&rsquo;s worth checking who else fits before you take it.
        </p>
        {/* onSubmit bubbles from any nested form, so this covers the
            confirm form and every alternative without each one needing
            to know about the dialog. The close is deferred a tick
            because React's synthetic submit runs before the browser's
            native submission — closing synchronously would unmount the
            form before its action ran. Same reasoning as ActionMenu's
            own deferred close. */}
        <div className="mt-4 flex flex-col gap-3" onSubmit={() => setTimeout(() => ref.current?.close(), 0)}>
          <form action={confirmClaimAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <button
              type="submit"
              className="self-start rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)]"
            >
              Yes, I&rsquo;ll take it
            </button>
          </form>
          {alternatives}
          {flagForm}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="self-start px-1 text-[13px] text-[var(--accent-1)] hover:underline"
          >
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
