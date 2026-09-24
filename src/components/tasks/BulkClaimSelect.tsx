"use client";

import { useState } from "react";
import { bulkClaimAction } from "@/app/(app)/board/actions";
import { BUTTON_PRIMARY } from "@/components/ui/kit";

// The board's one acceptable slice of client state (per cycle-scope
// conventions / decision 4): a per-task checkbox select mode for the bulk
// claim. Everything else on the board stays server-rendered. Selecting
// rows only toggles this local <Set>; submitting posts the checked
// taskIds to the same bulkClaimAction the page used server-side.
export default function BulkClaimSelect({
  claimable,
  branchNameById,
}: {
  claimable: Array<{ id: string; title: string; branchId: string | null }>;
  branchNameById: Map<string, string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
        {selected.size > 0
          ? `Claim ${selected.size} selected`
          : `Bulk claim (${claimable.length} eligible in this view)`}
      </summary>
      <form action={bulkClaimAction} className="mt-3 flex flex-col gap-2">
        {claimable.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <input
              type="checkbox"
              name="taskIds"
              value={t.id}
              onChange={(e) => toggle(t.id, e.target.checked)}
            />
            {t.title} <span className="text-[var(--text-muted)]">({t.branchId ? branchNameById.get(t.branchId) ?? "—" : "—"})</span>
          </label>
        ))}
        <button type="submit" disabled={selected.size === 0} className={`${BUTTON_PRIMARY} mt-1 w-fit disabled:opacity-50`}>
          Claim selected
        </button>
      </form>
    </details>
  );
}
