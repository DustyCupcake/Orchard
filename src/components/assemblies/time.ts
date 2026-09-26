// Time phrasing shared by the Assembly surfaces.
//
// Hand-rolled rather than Intl.RelativeTimeFormat or `toLocaleString`
// on purpose: these strings render on the server *and* the client, and
// a locale- or timezone-dependent formatter disagrees between the two
// (a hydration mismatch) for what is really just "a couple of days".
// Nothing here needs absolute dates — those sit alongside, from
// toLocaleString, on the pages that already show them.

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A span of time, coarsened: 1440000ms → "24 hours", 259200000ms → "3 days". */
export function humanizeDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 60 * 24 * 3) return plural(Math.round(minutes / 60), "hour");
  if (minutes < 60 * 24 * 21) return plural(Math.round(minutes / (60 * 24)), "day");
  return plural(Math.round(minutes / (60 * 24 * 7)), "week");
}

/**
 * How far away a moment is, in either direction: "in 2 days" for
 * something ahead, "3 hours ago" for something behind.
 *
 * Deliberately coarse. The absolute timestamp belongs right next to
 * this whenever it matters — this answers "is there still time", which
 * is the question a member opens an Assembly page with, and it stops
 * implying a precision the underlying windows don't have.
 */
export function relativeTime(target: Date | number, now: Date | number): string {
  const targetMs = target instanceof Date ? target.getTime() : target;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const ms = targetMs - nowMs;
  if (Math.abs(ms) < 60_000) return "now";
  return ms > 0 ? `in ${humanizeDuration(ms)}` : `${humanizeDuration(-ms)} ago`;
}
