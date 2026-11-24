"use client";

import { Tag } from "@/components/ui/kit";
import ShiftSlotVisual from "@/components/shifts/ShiftSlotVisual";
import type { ShiftViewRow } from "@/lib/shifts/views";

/**
 * "card" is one shift in the chronological list; "modal" is the same shift
 * inside the dialog a calendar block opens (the dialog's heading already says
 * the title and time); "compact" is one more date of a standing series, whose
 * card already says the title.
 *
 * Every variant carries the shift's own actions (Sign up / Withdraw / not
 * open yet), so a shift can be joined from wherever it is shown.
 */
export default function ShiftRowCard({
  row,
  variant = "card",
}: {
  row: ShiftViewRow;
  variant?: "card" | "modal" | "compact";
}) {
  const slots = (
    <p className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
      <ShiftSlotVisual capacity={row.capacity} signups={row.signups} />
      {row.signups}/{row.capacity} signed up
      {row.iAmSignedUp && <Tag tone="success">You&rsquo;re signed up</Tag>}
      {row.signups >= row.capacity && !row.iAmSignedUp && row.capacity > 5 && <Tag tone="warning">full</Tag>}
      {!row.signupsOpen && <Tag tone="neutral">not open yet</Tag>}
    </p>
  );

  if (variant === "compact") {
    return (
      <div className="flex flex-col gap-1.5 border-b border-[var(--border)] py-2 last:border-b-0">
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">{row.when}</p>
        {slots}
        <div>{row.actions}</div>
      </div>
    );
  }

  const body = (
    <>
      {variant === "card" && (
        <>
          <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
            {row.title}
            {row.branchId && <span className="font-normal text-[var(--text-muted)]"> · {row.branchName}</span>}
          </p>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{row.when}</p>
        </>
      )}
      {variant === "modal" && row.branchId && (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">{row.branchName}</p>
      )}
      {row.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{row.description}</p>}
      <div className="mt-1.5">{slots}</div>
      <div className="mt-2">{row.actions}</div>
    </>
  );

  if (variant === "modal") return <div>{body}</div>;
  return (
    <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      {body}
    </div>
  );
}
