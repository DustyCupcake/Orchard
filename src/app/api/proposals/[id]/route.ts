import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getProposal } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const proposal = await getProposal(actor, id);
    return NextResponse.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}
