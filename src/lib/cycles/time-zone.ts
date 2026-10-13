import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle } from "@/db/schema";
import { effectiveTimeZone, instantFromZoned } from "../dates/timezone";

/**
 * The wall-clock an event runs on — its own zone if it set one, else the
 * Community's, else UTC. With no event (a community-wide thing), just the
 * Community's. This is the clock a typed-in time belongs to and the one the
 * programme and shifts are read in; what a *viewer* sees a deadline as is
 * their own zone, which is a different question — see
 * src/lib/dates/timezone.ts.
 *
 * Takes the community id and checks the event belongs to it, so a cycle id
 * out of a form can't be used to read another community's setting.
 */
export async function getEventTimeZone(
  communityId: string,
  cycleId: string | null | undefined,
): Promise<string> {
  const [communityRow] = await db
    .select({ timeZone: community.timeZone })
    .from(community)
    .where(eq(community.id, communityId));
  const [cycleRow] = cycleId
    ? await db
        .select({ timeZone: cycle.timeZone })
        .from(cycle)
        .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)))
    : [];
  return effectiveTimeZone(cycleRow, communityRow ?? {});
}

/**
 * A `datetime-local` value typed by an organizer -> the instant it names,
 * read on the event's clock.
 *
 * Deadlines and windows are typed on the event's clock and shown to each
 * member on their own, so what an organizer means by "18:00" doesn't move
 * with the server or with where they happen to be sitting. `new Date(raw)`
 * on the same string would read it in the server's zone.
 */
export async function eventInstantFromLocal(
  communityId: string,
  cycleId: string | null | undefined,
  local: string,
): Promise<string> {
  return instantFromZoned(local, await getEventTimeZone(communityId, cycleId)).toISOString();
}

/**
 * Every event's clock in one read, for a list that spans several of them
 * (a calendar, a dashboard, a contribution history). Returns a lookup from
 * an event id — or null for a community-wide thing — to the zone its times
 * are read in, falling back to the Community's.
 */
export async function getEventClocks(communityId: string): Promise<(cycleId: string | null | undefined) => string> {
  const [communityRow] = await db
    .select({ timeZone: community.timeZone })
    .from(community)
    .where(eq(community.id, communityId));
  const rows = await db
    .select({ id: cycle.id, timeZone: cycle.timeZone })
    .from(cycle)
    .where(eq(cycle.communityId, communityId));
  const byId = new Map(rows.map((r) => [r.id, r.timeZone] as const));
  return (cycleId) =>
    effectiveTimeZone({ timeZone: cycleId ? byId.get(cycleId) : null }, communityRow ?? {});
}
