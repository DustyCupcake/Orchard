"use client";

import FilterBar, { type FilterField } from "@/components/ui/FilterBar";
import { formatExactDate } from "@/lib/dates";
import { DEFAULT_FILTERS, type ShiftViewFilters } from "@/lib/shifts/views";

/**
 * The shift views' filters, on the shared filter bar: "only with free slots"
 * and tags (any-of) and branch everywhere, plus day and time-of-day ranges
 * where `dayFilters` is on (an event's list and calendar — a standing series
 * repeats across weeks, so a day range means little there). All client
 * state; the caller owns it.
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
  const fields: FilterField[] = [
    {
      id: "available",
      kind: "toggle",
      label: "Only with free slots",
      chipLabel: "Free slots",
      checked: filters.availableOnly,
      onChange: (availableOnly) => setFilter({ availableOnly }),
    },
  ];
  if (tags.length > 0) {
    fields.push({
      id: "tags",
      kind: "multi",
      label: "Tags",
      values: filters.tags,
      options: tags.map((t) => ({ value: t, label: t })),
      onChange: (values) => setFilter({ tags: values }),
    });
  }
  if (branches.length > 0) {
    fields.push({
      id: "branch",
      kind: "select",
      label: "Branch",
      anyLabel: "Any branch",
      value: filters.branchId,
      options: branches.map((b) => ({ value: b.id, label: b.name })),
      onChange: (branchId) => setFilter({ branchId }),
    });
  }
  if (dayFilters) {
    fields.push(
      {
        id: "days",
        kind: "range",
        inputType: "date",
        label: "Days",
        from: filters.from,
        to: filters.to,
        format: formatExactDate,
        onChange: ({ from, to }) => setFilter({ from, to }),
      },
      {
        id: "time",
        kind: "range",
        inputType: "time",
        label: "Time of day",
        from: filters.timeFrom,
        to: filters.timeTo,
        onChange: ({ from, to }) => setFilter({ timeFrom: from, timeTo: to }),
      },
    );
  }

  return (
    <FilterBar
      fields={fields}
      onClear={() => setFilter({ ...DEFAULT_FILTERS })}
      clearable={JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)}
    />
  );
}
