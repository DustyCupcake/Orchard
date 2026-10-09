import { cache } from "react";
import { effectiveTimeZone, formatInstant } from "./dates";
import { getCommunity } from "./settings";
import { getViewingContext } from "./view-as";

type Instant = Date | string | number;

/**
 * How a page writes a moment for the person looking at it: on their own
 * clock — Member.timeZone, else the Community's, else UTC.
 *
 * This is for deadlines, "sent at", "edited at" and the like: things whose
 * meaning to the reader is "when is that for me". The venue's clock is a
 * different thing, used for the programme and shifts, and isn't this; see
 * src/lib/dates/timezone.ts.
 *
 * Server components used to write `new Date(x).toLocaleString()`, which is
 * the *server process's* zone and locale — the same for everyone and not
 * the reader's own, and only right by accident while the server happens to
 * run in UTC.
 */
export interface ViewerClock {
  timeZone: string;
  /** "Oct 9, 2026, 15:04" */
  dateTime: (instant: Instant) => string;
  /** "Oct 9, 2026" */
  date: (instant: Instant) => string;
  /** "15:04" */
  time: (instant: Instant) => string;
  /** "Oct 9, 2026, 15:04 GMT+2" — a deadline names its zone. */
  deadline: (instant: Instant) => string;
}

export function clockFor(timeZone: string): ViewerClock {
  return {
    timeZone,
    dateTime: (i) => formatInstant(i, timeZone),
    date: (i) => formatInstant(i, timeZone, "date"),
    time: (i) => formatInstant(i, timeZone, "time"),
    deadline: (i) => formatInstant(i, timeZone, "datetime", { zoneName: true }),
  };
}

// Memoised per request, so a page and the components under it can each ask
// without repeating the two lookups.
export const getViewerClock = cache(async (): Promise<ViewerClock> => {
  const { viewing } = await getViewingContext();
  if (!viewing) return clockFor(effectiveTimeZone(null, {}));
  return clockFor(effectiveTimeZone(viewing, await getCommunity(viewing)));
});
