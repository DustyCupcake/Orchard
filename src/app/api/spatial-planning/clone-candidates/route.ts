import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listCyclesWithPlot } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const excludeCycleId = request.nextUrl.searchParams.get("excludeCycleId");
    if (!excludeCycleId) throw new AppError("excludeCycleId is required");
    const candidates = await listCyclesWithPlot(actor, excludeCycleId);
    return NextResponse.json({ candidates });
  } catch (err) {
    return errorResponse(err);
  }
}
