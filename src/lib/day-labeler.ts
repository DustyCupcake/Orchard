import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, phase } from "@/db/schema";
import { buildDayScopes, createDayLabeler, effectiveDateDisplayMode, type DayLabeler } from "./dates";
import { getCommunity } from "./settings";
import { getViewingContext } from "./view-as";

/**
 * Every event in the community with its phases, in two queries, keyed by
 * event id. Events are few and phases fewer, so this loads them all rather
 * than one event at a time: the same shape as `getEventClocks`, and it means
 * a page can label a day for any row it holds without knowing in advance
 * which events its rows come from.
 *
 * Closed and past events are included on purpose: reading last year's
 * roster as "Fri" is correct inside that event's own dates.
 */
export async function loadDayScopes(communityId: string) {
  const [cycles, phases] = await Promise.all([
    db
      .select({ id: cycle.id, name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate })
      .from(cycle)
      .where(eq(cycle.communityId, communityId)),
    // A phase carries only its event's id, so it is scoped to the community
    // by joining through its event.
    db
      .select({
        id: phase.id,
        cycleId: phase.cycleId,
        name: phase.name,
        order: phase.order,
        startDate: phase.startDate,
        endDate: phase.endDate,
      })
      .from(phase)
      .innerJoin(cycle, eq(phase.cycleId, cycle.id))
      .where(eq(cycle.communityId, communityId)),
  ]);
  return buildDayScopes(cycles, phases);
}

/**
 * How this page writes a day for the person looking at it: their own date
 * display setting (Member override, else the Community default) and every
 * event's periods, behind one object. See docs/plans/day-labels-plan.md.
 *
 * Memoised per request, like `getViewerClock`, so a page and the components
 * under it can each ask without repeating the lookups.
 */
export const getDayLabeler = cache(async (): Promise<DayLabeler> => {
  const { viewing } = await getViewingContext();
  // Signed out (or no viewing member): there is no setting to follow and no
  // events to read, so every day is a plain date.
  if (!viewing) return createDayLabeler("exact", new Map());
  const [communityRow, scopes] = await Promise.all([getCommunity(viewing), loadDayScopes(viewing.communityId)]);
  return createDayLabeler(effectiveDateDisplayMode(viewing, communityRow), scopes);
});
