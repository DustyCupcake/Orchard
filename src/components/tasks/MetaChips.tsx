import type { ReactNode } from "react";
// /dist/ssr — these render inside Server Components (see StatusIcon).
import {
  GitBranchIcon,
  ClockIcon,
  UsersIcon,
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
} from "@phosphor-icons/react/dist/ssr";

// Task UI grammar (docs/design_handoff_conventions/README.md): task
// metadata renders as small icon+value chips, not a "·"-separated
// sentence. One chip per fact; the row wraps. Used on cards and under
// the detail-page title.
export function MetaChip({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)]"
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

export function CapacityChip({ held, capacity }: { held: number; capacity: number | null }) {
  return (
    <MetaChip icon={<UsersIcon size={13} />} title={capacity !== null ? `${held} of ${capacity} slots held` : `${held} holder(s)`}>
      {held}
      {capacity !== null ? `/${capacity}` : ""}
    </MetaChip>
  );
}

export function CycleChip({ name }: { name: string }) {
  return <MetaChip icon={<ArrowsClockwiseIcon size={13} />}>{name}</MetaChip>;
}

export function DateChip({ date, label }: { date: Date | string; label?: string }) {
  const d = typeof date === "string" ? date : date.toLocaleDateString();
  return (
    <MetaChip icon={<CalendarBlankIcon size={13} />} title={label}>
      {label ? `${label} ${d}` : d}
    </MetaChip>
  );
}
