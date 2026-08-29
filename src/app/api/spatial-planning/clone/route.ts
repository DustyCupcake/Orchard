import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { clonePlotFromCycle } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Holder-gated inside clonePlotFromCycle. This is the standalone
// spatial-plan clone (docs/spec.md's "Cloning across cycles") —
// independent of Cycle creation itself, which is Phase 38's own,
// separate integration into the existing clone-previous-cycle flow.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const { targetCycleId, sourceCycleId } = await request.json();
    if (!targetCycleId || !sourceCycleId) {
      throw new AppError("targetCycleId and sourceCycleId are required");
    }
    const plot = await clonePlotFromCycle(actor, targetCycleId, sourceCycleId);
    return NextResponse.json({ plot }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
