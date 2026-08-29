import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createEventProposal, createEventProposalInput, listMyEventProposals } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

// Community-scoped, submitter-only listing — see src/lib/event-
// scheduling/review.ts's listEventProposalsForReview for the owner's
// broader view, and /api/event-schedule for the published one.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const cycleIdParam = request.nextUrl.searchParams.get("cycleId");
    const cycleId = cycleIdParam === null ? undefined : cycleIdParam === "" ? null : cycleIdParam;
    const proposals = await listMyEventProposals(actor, cycleId);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

// Open to any member — "any member submits a proposal."
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createEventProposalInput.parse(await request.json());
    const created = await createEventProposal(actor, body);
    return NextResponse.json({ proposal: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
