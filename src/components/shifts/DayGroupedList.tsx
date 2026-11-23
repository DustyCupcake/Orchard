"use client";

import type { ReactNode } from "react";

/**
 * A chronological list of day groups: for each day — a small heading naming
 * the day, a line across the full width underneath it, then the day's items
 * in order. The shift views' list half (src/app/(app)/shifts). Generic: the
 * programme and other day-based views reuse this.
 */
export default function DayGroupedList({ groups }: { groups: { label: string; items: ReactNode[] }[] }) {
  if (groups.length === 0) return null;
  return (
    <div>
      {groups.map((g, i) => (
        <section key={g.label} className={i > 0 ? "mt-6" : ""}>
          <h3 className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">{g.label}</h3>
          <div className="mt-1.5 mb-4 border-b border-[var(--border)]" />
          <div className="flex flex-col gap-3">{g.items}</div>
        </section>
      ))}
    </div>
  );
}
