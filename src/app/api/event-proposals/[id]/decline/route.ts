import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { declineEventProposal } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Owner-only, enforced inside declineEventProposal.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const updated = await declineEventProposal(actor, id);
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
