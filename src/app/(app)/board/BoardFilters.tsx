"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FilterBar, { type FilterField } from "@/components/ui/FilterBar";

// Every board query param that is a filter (as opposed to the view tab or
// the sort-by-fit switch), which "Clear" removes.
const FILTER_PARAMS = [
  "branchId",
  "tag",
  "hideCycleless",
  "attention",
  "phaseId",
  "duration",
  "hasSlots",
  "assignedToMe",
  "dueWithin",
] as const;

/**
 * The board's filters on the shared filter bar. The filters live in the URL
 * (the server re-queries on each change), so each setter clones the current
 * params, overrides its own, and navigates — keeping the view tab, sort and
 * every other filter. `scroll: false` so changing a filter in the dialog
 * doesn't jump the page to the top.
 */
export default function BoardFilters({
  branches,
  tags,
  phases,
  values,
  trailing,
}: {
  branches: { id: string; name: string }[];
  tags: string[];
  phases: { id: string; name: string }[];
  values: {
    branchId?: string;
    tag?: string;
    hideCycleless: boolean;
    attention?: string;
    phaseId?: string;
    duration?: string;
    hasSlots: boolean;
    assignedToMe: boolean;
    dueWithin?: string;
  };
  /** The sort switch, which sits after the chips but isn't a filter. */
  trailing?: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The params as last asked for. Navigation takes a moment to land, and a
  // second click before it does would otherwise clone the *old* URL and
  // undo the first change. `base` ties the pending query to the URL it was
  // built from, so once the URL moves on it stops applying.
  const committed = searchParams.toString();
  const [pending, setPending] = useState<{ base: string; query: string } | null>(null);
  const current = pending && pending.base === committed ? pending.query : committed;

  function go(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(current);
    mutate(params);
    const query = params.toString();
    setPending({ base: committed, query });
    router.push(query ? `/board?${query}` : "/board", { scroll: false });
  }
  const setParam = (name: string, value: string | null) =>
    go((p) => (value ? p.set(name, value) : p.delete(name)));

  const select = (
    id: string,
    label: string,
    anyLabel: string,
    value: string | undefined,
    options: { value: string; label: string }[],
  ): FilterField => ({
    id,
    kind: "select",
    label,
    anyLabel,
    value: value ?? null,
    options,
    onChange: (v) => setParam(id, v),
  });
  const toggle = (id: string, label: string, checked: boolean, chipLabel?: string): FilterField => ({
    id,
    kind: "toggle",
    label,
    chipLabel,
    checked,
    onChange: (on) => setParam(id, on ? "1" : null),
  });

  const fields: FilterField[] = [
    select("branchId", "Branch", "All branches", values.branchId, branches.map((b) => ({ value: b.id, label: b.name }))),
  ];
  if (tags.length > 0) {
    fields.push(select("tag", "Tag / cluster", "All tags", values.tag, tags.map((t) => ({ value: t, label: t }))));
  }
  fields.push(
    toggle("hasSlots", "Has open slots", values.hasSlots),
    toggle("assignedToMe", "Assigned to me", values.assignedToMe),
    toggle("hideCycleless", "Hide not-event-scoped tasks", values.hideCycleless, "Event-scoped only"),
    select("attention", "Attention", "Any attention", values.attention, [
      { value: "soft", label: "Soft flag" },
      { value: "hard", label: "Hard flag" },
      { value: "escalated", label: "Escalated" },
    ]),
  );
  if (phases.length > 0) {
    fields.push(select("phaseId", "Phase", "Any phase", values.phaseId, phases.map((p) => ({ value: p.id, label: p.name }))));
  }
  fields.push(
    select("duration", "Duration", "Any duration", values.duration, [
      { value: "under_hour", label: "Under an hour" },
      { value: "few_hours", label: "A few hours" },
      { value: "half_day", label: "Half a day" },
      { value: "multi_day", label: "Multi-day" },
    ]),
    select("dueWithin", "Deadline", "Any deadline", values.dueWithin, [
      { value: "7", label: "Due within 7 days" },
      { value: "14", label: "Due within 14 days" },
      { value: "30", label: "Due within 30 days" },
    ]),
  );

  return <FilterBar fields={fields} onClear={() => go((p) => FILTER_PARAMS.forEach((k) => p.delete(k)))} trailing={trailing} />;
}
