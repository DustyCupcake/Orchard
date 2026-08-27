import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { activateProposal, activateProposalInput } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = activateProposalInput.parse(await request.json());
    const result = await activateProposal(actor, id, body);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
