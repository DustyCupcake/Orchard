import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { claimOrRequestToJoin } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// Claiming an already-held `request`/`coordination_approved` task
// creates a pending join request instead of an instant claim — see
// docs/spec.md's "Request to join". Same endpoint either way; the
// response shape tells the caller which one happened.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const result = await claimOrRequestToJoin(actor, id);
    return NextResponse.json(result, { status: result.status === "requested" ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
