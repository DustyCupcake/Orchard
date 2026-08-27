import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { declineProposal } from "@/lib/proposals";

export const dynamic = "force-dynamic";

const declineInput = z.object({ reason: z.string().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = declineInput.parse(await request.json().catch(() => ({})));
    const proposal = await declineProposal(actor, id, body.reason);
    return NextResponse.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}
