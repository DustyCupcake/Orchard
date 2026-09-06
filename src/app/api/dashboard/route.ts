import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { resolveDefaultScopeSegment, resolveViewScopeFromSegment } from "@/lib/cycles";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    // Same off-URL nav-switcher resolution the dashboard page itself
    // reads (docs/development-plan.md's Phase 69) — this API mirrors the
    // page's data, so it shouldn't fall back to a stale, unscoped read.
    const scopeSegment = await resolveDefaultScopeSegment(actor);
    const scope = await resolveViewScopeFromSegment(actor, scopeSegment);
    const cycleIds = scope ? (scope.kind === "aggregate" ? scope.cycles.map((c) => c.id) : [scope.cycle.id]) : [];
    const singleCycleId = scope?.kind === "single" ? scope.cycle.id : null;

    const [feed, snapshot] = await Promise.all([
      getPersonalFeed(actor),
      getCommunitySnapshot(actor, { cycleIds, singleCycleId }),
    ]);
    return NextResponse.json({ feed, snapshot });
  } catch (err) {
    return errorResponse(err);
  }
}
