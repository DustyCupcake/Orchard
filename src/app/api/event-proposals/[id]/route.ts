import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getEventProposal, updateEventProposal, updateEventProposalInput } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const proposal = await getEventProposal(actor, id);
    return NextResponse.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}

// Submitter-only, enforced inside updateEventProposal.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = updateEventProposalInput.parse(await request.json());
    const updated = await updateEventProposal(actor, id, body);
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
