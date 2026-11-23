"use client";

import Modal from "@/components/ui/Modal";
import ShiftSlotVisual from "@/components/shifts/ShiftSlotVisual";
import type { GridTone } from "@/components/shifts/DayColumnsGrid";
import type { ShiftViewRow } from "@/lib/shifts/views";
import ShiftRowCard from "./ShiftRowCard";

/** How a shift's block is tinted: yours, full, not open yet, or open to join. */
export function toneOfShift(row: ShiftViewRow): GridTone {
  if (row.iAmSignedUp) return "mine";
  if (!row.signupsOpen) return "closed";
  if (row.signups >= row.capacity) return "full";
  return "open";
}

/**
 * One shift drawn on the calendar grid: the slot visual, the series title and
 * its times. The whole block is a button that opens the shift's card, with the
 * same Sign up / Withdraw actions the list has.
 */
export default function ShiftBlock({ row }: { row: ShiftViewRow }) {
  return (
    <Modal
      title={row.title}
      description={row.when}
      triggerClassName="block h-full w-full cursor-pointer overflow-hidden px-1 text-left hover:brightness-95"
      trigger={
        <span className="flex h-full flex-col justify-center gap-0.5">
          <span className="flex items-center gap-0.5">
            <ShiftSlotVisual capacity={row.capacity} signups={row.signups} />
            <span className="truncate text-[length:var(--text-body)] font-medium leading-tight text-[var(--text)]">
              {row.title}
            </span>
          </span>
          <span className="truncate text-[length:var(--text-micro)] leading-tight text-[var(--text-muted)]">
            {row.startTime}&ndash;{row.endTime}
          </span>
        </span>
      }
    >
      <ShiftRowCard row={row} variant="modal" />
    </Modal>
  );
}

/** A "+N more" chip standing in for shifts that would not fit beside the others. */
export function ShiftOverflowChip({ rows }: { rows: ShiftViewRow[] }) {
  return (
    <Modal
      title={`${rows.length} more shifts at this time`}
      triggerClassName="flex h-full w-full cursor-pointer items-center justify-center px-1 text-[length:var(--text-micro)] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
      trigger={<>+{rows.length} more</>}
    >
      {rows.map((r) => (
        <ShiftRowCard key={r.id} row={r} />
      ))}
    </Modal>
  );
}
