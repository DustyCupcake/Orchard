import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createPlot, getPlotForCycle } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Absent/empty cycleId means "the one, whole-Community Plot" (a
// Community that never turned Cycles on) — see
// src/lib/spatial-planning/plots.ts's getPlotForCycle.
function parseCycleId(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("cycleId");
  return raw === null || raw === "" ? null : raw;
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const plot = await getPlotForCycle(actor, parseCycleId(request));
    return NextResponse.json({ plot });
  } catch (err) {
    return errorResponse(err);
  }
}

// Holder-gated inside createPlot — "visible to any member" is just the
// GET above; only the Spatial-planning task holder can create/edit.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = await request.json();
    const { cycleId, ...input } = body;
    const created = await createPlot(actor, cycleId ?? null, input);
    return NextResponse.json({ plot: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
