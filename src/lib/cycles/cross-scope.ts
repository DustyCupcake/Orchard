import type { cycle as cycleTable, member as memberTable } from "@/db/schema";
import { resolveDefaultScopeSegment, resolveViewScopeFromSegment, type ResolvedViewScope } from "./view-scope";

type Member = typeof memberTable.$inferSelect;
type CycleRow = typeof cycleTable.$inferSelect;

function scopeContainsCycle(scope: ResolvedViewScope, cycleId: string): boolean {
  return scope.kind === "single" ? scope.cycle.id === cycleId : scope.cycles.some((c) => c.id === cycleId);
}

function sameScope(a: ResolvedViewScope, b: ResolvedViewScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "single" && b.kind === "single" ? a.cycle.id === b.cycle.id : true;
}

export function scopeLabel(scope: ResolvedViewScope): string {
  return scope.kind === "single" ? scope.cycle.name : "All active cycles";
}

export type CrossCycleContext = {
  // The viewer's own real active scope — never derived from a URL
  // segment (object-detail pages like a task aren't under
  // [cycleScope]), always resolveDefaultScopeSegment's resolution.
  activeScope: ResolvedViewScope;
  activeScopeSegment: string;
  // Set when the object's own cycle isn't covered by the viewer's
  // active scope — null for a cycle-less object, or when it agrees.
  mismatchedObjectCycle: CycleRow | null;
  // Set only when a "?scope=" query param is present AND resolves to
  // something other than the viewer's own active scope — i.e. a
  // shared link whose carried scope disagrees with what the visitor
  // already has selected. An invalid/foreign/matching param yields
  // null here, same as if it weren't present at all.
  linkedScope: { segment: string; scope: ResolvedViewScope } | null;
};

// docs/development-plan.md's Phase 66 — an object-detail page (a
// task; "a wiki page" only in the loose sense of a task's own wiki
// section, since the freestanding Documentation WikiPage carries no
// cycleId of its own to reconcile against) can be reached for an
// object whose own cycle disagrees with the viewer's active view
// scope. This never writes anything — comparing scopes here never
// touches Member.lastViewedCycleId, which stays the nav switcher's
// own exclusive write (see nav-actions.ts's setViewScopeAction).
export async function resolveCrossCycleContext(
  actor: Member,
  objectCycle: CycleRow | null,
  scopeParam: string | null,
): Promise<CrossCycleContext> {
  const activeScopeSegment = await resolveDefaultScopeSegment(actor);
  const activeScope = await resolveViewScopeFromSegment(actor, activeScopeSegment);
  if (!activeScope) {
    throw new Error("resolveDefaultScopeSegment returned a segment that doesn't itself resolve");
  }

  const mismatchedObjectCycle =
    objectCycle && !scopeContainsCycle(activeScope, objectCycle.id) ? objectCycle : null;

  let linkedScope: CrossCycleContext["linkedScope"] = null;
  if (scopeParam) {
    const resolved = await resolveViewScopeFromSegment(actor, scopeParam);
    if (resolved && !sameScope(resolved, activeScope)) {
      linkedScope = { segment: scopeParam, scope: resolved };
    }
  }

  return { activeScope, activeScopeSegment, mismatchedObjectCycle, linkedScope };
}
