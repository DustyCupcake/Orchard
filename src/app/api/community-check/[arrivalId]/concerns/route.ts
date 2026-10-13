import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { raiseConcern, raiseConcernInput } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// The one way to raise a concern about an arrival whose community check is open
// (docs/plans/admission-flow.md §5). Any member of the community except whoever stood
// behind the arrival; enforced inside raiseConcern.
export async function POST(request: NextRequest, { params }: { params: Promise<{ arrivalId: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { arrivalId } = await params;
    const body = raiseConcernInput.parse(await request.json());
    const created = await raiseConcern(actor, arrivalId, body);
    // The concern itself, without who raised it — the response goes to them, but a
    // client that logs or caches it shouldn't be holding the shield's identity.
    return NextResponse.json({ concern: { id: created.id, raisedAt: created.raisedAt } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
