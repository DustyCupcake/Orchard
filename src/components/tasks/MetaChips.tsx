import type { ReactNode } from "react";
import { formatInstant } from "@/lib/dates";
// /dist/ssr — these render inside Server Components (see StatusIcon).
import {
  GitBranchIcon,
  ClockIcon,
  UsersIcon,
  TicketIcon,
  CalendarBlankIcon,
} from "@phosphor-icons/react/dist/ssr";

// Task UI grammar (docs/design_handoff_conventions/README.md): task
// metadata renders as small icon+value chips, not a "·"-separated
// sentence. One chip per fact; the row wraps. Used on cards and under
// the detail-page title.
export function MetaChip({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[length:var(--text-meta)] text-[var(--text-muted)]"
      title={title}
    >
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

export function BranchChip({ name }: { name: string }) {
  return <MetaChip icon={<GitBranchIcon size={13} />}>{name}</MetaChip>;
}

export function EffortChip({ summary }: { summary: string }) {
  return <MetaChip icon={<ClockIcon size={13} />}>{summary}</MetaChip>;
}

// D4 (docs/plans/task-interface-plan.md): up to five slots render as
// dots so a gap is visible without reading numbers — ●●○ is scannable
// in a way "1/3" isn't. Beyond five a count reads better than a row of
// dots. Empty dots are muted, or danger on a critical task, where an
// unfilled slot is the thing that matters.
export function CapacityChip({ held, capacity, critical }: { held: number; capacity: number | null; critical?: boolean }) {
  const label = capacity !== null ? `${held} of ${capacity} slots held` : `${held} holder(s)`;
  return (
    <MetaChip icon={<UsersIcon size={13} />} title={label}>
      {capacity !== null && capacity <= 5 ? (
        <span aria-hidden="true" className="inline-flex items-center gap-0.5">
          {Array.from({ length: capacity }, (_, i) => (
            <span
              key={i}
              className={
                i < held
                  ? "text-[var(--text)]"
                  : critical
                    ? "text-[var(--danger)]"
                    : "text-[var(--text-muted)]"
              }
            >
              {i < held ? "●" : "○"}
            </span>
          ))}
          <span className="sr-only">{label}</span>
        </span>
      ) : (
        <>
          {held}
          {capacity !== null ? `/${capacity}` : ""}
        </>
      )}
    </MetaChip>
  );
}

// Ticket, matching nav-config's "cycle" icon: the chip names the event a
// task belongs to, not a recurrence, so the same glyph is right in both
// places.
export function CycleChip({ name }: { name: string }) {
  return <MetaChip icon={<TicketIcon size={13} />}>{name}</MetaChip>;
}

export function DateChip({ date, label }: { date: Date | string; label?: string }) {
  const d = typeof date === "string" ? date : formatInstant(date, "UTC", "date");
  return (
    <MetaChip icon={<CalendarBlankIcon size={13} />} title={label}>
      {label ? `${label} ${d}` : d}
    </MetaChip>
  );
}
