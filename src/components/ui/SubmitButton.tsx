"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

// A plain <button type="submit"> inside a Server Action <form> stays
// enabled while the action is in flight, so a slow round-trip (or an
// impatient double-click/double-Enter) fires the action more than once —
// e.g. an assembly agenda item getting added several times over. This
// wraps useFormStatus's pending flag so the button disables itself for
// the duration of its own form's submission.
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
