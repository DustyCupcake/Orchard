"use client";

import { BUTTON_GHOST, INPUT } from "@/components/ui/kit";
import { NO_FILTERS, type ShiftViewFilters } from "@/lib/shifts/views";

const FILTER_LABEL = "text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]";

/**
 * The filter bar the shift views share: tags (any-of) and branch everywhere,
 * plus From/To day and time ranges where `dayFilters` is on (an event's list
 * and calendar — a standing series repeats across weeks, so a day range means
 * little there). All client state; the caller owns it.
 */
export default function ShiftFilters({
  tags,
  branches,
  filters,
  setFilter,
  dayFilters,
}: {
  tags: string[];
  branches: { id: string; name: string }[];
  filters: ShiftViewFilters;
  setFilter: (patch: Partial<ShiftViewFilters>) => void;
  dayFilters: boolean;
}) {
  const anyActive = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const toggleTag = (tag: string, on: boolean) =>
    setFilter({ tags: on ? [...new Set([...filters.tags, tag])] : filters.tags.filter((t) => t !== tag) });

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
      {tags.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className={FILTER_LABEL}>Tags</span>
          {tags.map((t) => (
            <label key={t} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={filters.tags.includes(t)}
                onChange={(e) => toggleTag(t, e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span>{t}</span>
            </label>
          ))}
        </span>
      )}
      {branches.length > 0 && (
        <label className="inline-flex items-center gap-1">
          <span className={FILTER_LABEL}>Branch</span>
          <select value={filters.branchId ?? ""} onChange={(e) => setFilter({ branchId: e.target.value || null })} className={INPUT}>
            <option value="">Any branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {dayFilters && (
        <>
          <label className="inline-flex items-center gap-1">
            <span className={FILTER_LABEL}>From day</span>
            <input type="date" value={filters.from ?? ""} onChange={(e) => setFilter({ from: e.target.value || null })} className={INPUT} />
          </label>
          <label className="inline-flex items-center gap-1">
            <span className={FILTER_LABEL}>To day</span>
            <input type="date" value={filters.to ?? ""} onChange={(e) => setFilter({ to: e.target.value || null })} className={INPUT} />
          </label>
          <label className="inline-flex items-center gap-1">
            <span className={FILTER_LABEL}>From</span>
            <input type="time" value={filters.timeFrom ?? ""} onChange={(e) => setFilter({ timeFrom: e.target.value || null })} className={INPUT} />
          </label>
          <label className="inline-flex items-center gap-1">
            <span className={FILTER_LABEL}>To</span>
            <input type="time" value={filters.timeTo ?? ""} onChange={(e) => setFilter({ timeTo: e.target.value || null })} className={INPUT} />
          </label>
        </>
      )}
      {anyActive && (
        <button type="button" onClick={() => setFilter({ ...NO_FILTERS })} className={BUTTON_GHOST}>
          Clear filters
        </button>
      )}
    </span>
  );
}
