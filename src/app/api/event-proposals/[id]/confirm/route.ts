import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { confirmEventProposalSlot, confirmEventProposalSlotInput } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Owner-only, enforced inside confirmEventProposalSlot.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = confirmEventProposalSlotInput.parse(await request.json());
    const updated = await confirmEventProposalSlot(actor, id, body);
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
