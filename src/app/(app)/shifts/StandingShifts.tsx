"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/ui/kit";
import {
  NO_FILTERS,
  describeSeriesPattern,
  groupRowsBySeries,
  shiftMatchesFilters,
  type ShiftViewFilters,
  type ShiftViewRow,
} from "@/lib/shifts/views";
import ShiftFilters from "./ShiftFilters";
import ShiftRowCard from "./ShiftRowCard";

/** How many later dates a standing series lists before saying how many more there are. */
const LATER_DATES_SHOWN = 12;

/**
 * The standing schedule: one card per series rather than a timeline, because
 * a weekly rhythm makes a day-by-day list of the same shift repeated for
 * months. Each card says what the series is, how often it runs, and its next
 * shift — with Sign up right there — and opens out to the dates after it.
 * Tag and branch filters only; the day and time filters are for an event.
 */
export default function StandingShifts({
  rows,
  branches,
}: {
  rows: ShiftViewRow[];
  branches: { id: string; name: string }[];
}) {
  const [filters, setFilters] = useState<ShiftViewFilters>(NO_FILTERS);
  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);
  const groups = useMemo(
    () => groupRowsBySeries(rows.filter((r) => shiftMatchesFilters(r, filters))),
    [rows, filters],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ShiftFilters
          tags={tags}
          branches={branches}
          filters={filters}
          setFilter={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          dayFilters={false}
        />
      </div>

      {groups.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {rows.length === 0 ? "No upcoming standing shifts yet." : "No shifts match your filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(({ seriesId, rows: dates }) => {
            const [next, ...later] = dates;
            const pattern = describeSeriesPattern(dates);
            return (
              <section
                key={seriesId}
                className="rounded-[var(--radius-md)] border p-3"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                  {next.title}
                  {next.branchId && <span className="font-normal text-[var(--text-muted)]"> · {next.branchName}</span>}
                </p>
                {pattern && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{pattern}</p>}
                {next.description && (
                  <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{next.description}</p>
                )}
                {next.tags.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {next.tags.map((t) => (
                      <Tag key={t} tone="neutral">
                        {t}
                      </Tag>
                    ))}
                  </p>
                )}
                <div className="mt-2">
                  <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Next</p>
                  <ShiftRowCard row={next} variant="compact" />
                </div>
                {later.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                      {later.length === 1 ? "1 more date" : `${later.length} more dates`}
                    </summary>
                    <div className="mt-1">
                      {later.slice(0, LATER_DATES_SHOWN).map((r) => (
                        <ShiftRowCard key={r.id} row={r} variant="compact" />
                      ))}
                      {later.length > LATER_DATES_SHOWN && (
                        <p className="py-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          …and {later.length - LATER_DATES_SHOWN} later dates.
                        </p>
                      )}
                    </div>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
