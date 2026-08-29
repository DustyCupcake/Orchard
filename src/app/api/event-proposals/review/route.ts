import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listEventProposalsForReview } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

// Owner-only, enforced inside listEventProposalsForReview — recomputes
// conflicts fresh on every call before returning.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const cycleIdParam = request.nextUrl.searchParams.get("cycleId");
    const cycleId = cycleIdParam === null ? undefined : cycleIdParam === "" ? null : cycleIdParam;
    const proposals = await listEventProposalsForReview(actor, cycleId);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}
