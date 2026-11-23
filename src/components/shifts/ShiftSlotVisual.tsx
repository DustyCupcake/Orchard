"use client";

import { UsersIcon } from "@phosphor-icons/react";

/**
 * A shift's slot visual — the little icon and the open or full dots: the
 * same idea as the tasks' CapacityChip (src/components/tasks/MetaChips.tsx),
 * applied to shifts. One dot per slot, filled for the slots taken and open
 * for the free ones; when the roster is full the visual reads "full" — the
 * same word the shift list has always used for a full one. Beyond five
 * slots the dots are too many to be scannable, so the visual is absent and
 * the count text reads instead.
 */
export default function ShiftSlotVisual({ capacity, signups }: { capacity: number; signups: number }) {
  const full = signups >= capacity;
  if (capacity > 5) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={full ? "full" : `${signups} of ${capacity} slots held`}
      title={full ? `${signups} of ${capacity} slots held — full` : `${signups} of ${capacity} slots held`}
    >
      <UsersIcon size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      {full ? (
        <span className="font-medium text-[var(--text-muted)]">full</span>
      ) : (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: capacity }, (_, i) => (
            <span
              key={i}
              className={i < signups ? "text-[var(--text)]" : "text-[var(--text-muted)]"}
            >
              {i < signups ? "●" : "○"}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
