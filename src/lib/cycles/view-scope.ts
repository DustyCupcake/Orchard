import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listComingCycleIds } from "../participation";
import { listOpenCycles } from "./crud";

type Member = typeof memberTable.$inferSelect;
type CycleRow = typeof cycle.$inferSelect;

// "Every currently-open cycle the member has actually declared
// Participation `coming` for" — the nav's own "all active cycles"
// aggregate definition (docs/development-plan.md's Phase 65). Not
// "every cycle ever," not an arbitrary single pick.
export async function listActiveCyclesForMember(actor: Member): Promise<CycleRow[]> {
  const cycleIds = await listComingCycleIds(actor);
  if (cycleIds.length === 0) return [];
  return db.select().from(cycle).where(inArray(cycle.id, cycleIds));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedViewScope =
  | { kind: "aggregate"; cycles: CycleRow[] }
  | { kind: "single"; cycle: CycleRow };

// URL-driven resolution — used ONLY by the [cycleScope] layout/pages
// (/participation, /budget, both physically moved under it). Wrapped
// in React's cache() since the layout and its child page both need
// this within the same request — same "layout and page both need it"
// dedup this codebase's session.ts/dashboard.ts already establish.
export const resolveViewScopeFromSegment = cache(async function resolveViewScopeFromSegment(
  actor: Member,
  segment: string,
): Promise<ResolvedViewScope | null> {
  if (segment === "active") {
    return { kind: "aggregate", cycles: await listActiveCyclesForMember(actor) };
  }
  if (!UUID_RE.test(segment)) return null;
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, segment), eq(cycle.communityId, actor.communityId)));
  return row ? { kind: "single", cycle: row } : null;
});

// Shared 0/1/2+ resolution shape — Budget's own "which cycle?" prompt
// (resolveSingleCycleScope) and the off-URL resolver below
// (Messages/Contribution) both collapse to this same shape.
export type SingleCycleResolution =
  | { kind: "none" }
  | { kind: "resolved"; cycle: CycleRow }
  | { kind: "ambiguous"; candidates: CycleRow[] };

// Single-cycle-shaped-page helper (Budget only, per Phase 65's
// confirmed scope). A direct pick (a concrete cycle id in the URL)
// always resolves — no prompt, the member already narrowed; only
// "active" with 2+ coming-to cycles is ambiguous.
export async function resolveSingleCycleScope(actor: Member, segment: string): Promise<SingleCycleResolution> {
  if (segment === "active") {
    const candidates = await listActiveCyclesForMember(actor);
    if (candidates.length === 0) return { kind: "none" };
    if (candidates.length === 1) return { kind: "resolved", cycle: candidates[0] };
    return { kind: "ambiguous", candidates };
  }
  const scope = await resolveViewScopeFromSegment(actor, segment);
  return scope && scope.kind === "single" ? { kind: "resolved", cycle: scope.cycle } : { kind: "none" };
}

// Off-URL resolver — Messages' arrival_window (src/lib/messages.ts)
// and Contribution's community average (src/lib/contribution.ts),
// neither of which moved under [cycleScope]. Reads the persisted
// Member.lastViewedCycleId (null = aggregate default) since these two
// have no URL segment to read instead. Distinct from
// resolveSingleCycleScope above — don't conflate the two.
export async function resolveViewScopeCycleForMember(actor: Member): Promise<SingleCycleResolution> {
  if (actor.lastViewedCycleId) {
    const [row] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, actor.lastViewedCycleId), eq(cycle.communityId, actor.communityId)));
    if (row) return { kind: "resolved", cycle: row };
    // Stale/foreign reference — fall through to the aggregate default,
    // same graceful-degrade posture member.pinnedModuleKeys already
    // takes for a stale key.
  }
  const candidates = await listActiveCyclesForMember(actor);
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "resolved", cycle: candidates[0] };
  return { kind: "ambiguous", candidates };
}

// Which URL segment a bare /participation or /budget visit should
// redirect into. Deliberately NOT the same 0/1/2+ collapse as above:
// "active" is always a valid landing segment for Participation's own
// aggregate view (one section per open cycle, regardless of count —
// see its own page), so there's nothing to collapse here.
export async function resolveDefaultScopeSegment(actor: Member): Promise<string> {
  if (actor.lastViewedCycleId) {
    const [row] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, actor.lastViewedCycleId), eq(cycle.communityId, actor.communityId)));
    if (row) return row.id;
  }
  return "active";
}

// Re-exported here so callers of view-scope.ts's own resolvers (the
// [cycleScope] layout, the nav switcher) can get the dropdown's
// candidate list from the same module without a second import.
export { listOpenCycles };
