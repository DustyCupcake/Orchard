// Task.effort_magnitude's shape depends on Task.effort — a duration
// bucket string for one_off, an hours/week number for ongoing/
// owns_a_thing (see docs/spec.md's "Effort magnitude"). Shared between
// the board and the task detail view rather than duplicated.
export function effortSummary(effort: string, magnitude: unknown): string {
  if (magnitude && typeof magnitude === "object") {
    const m = magnitude as Record<string, unknown>;
    if (typeof m.hours_per_week === "number") return `${m.hours_per_week}h/week`;
    if (typeof m.duration === "string") return m.duration.replace(/_/g, " ");
  }
  return effort.replace(/_/g, " ");
}
