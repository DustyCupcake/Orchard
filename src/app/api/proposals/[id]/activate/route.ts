import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { activateProposal, activateProposalInput } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = activateProposalInput.parse(await request.json());
    const result = await activateProposal(actor, id, body);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
