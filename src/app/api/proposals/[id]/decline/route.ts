import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { declineProposal } from "@/lib/proposals";

export const dynamic = "force-dynamic";

const declineInput = z.object({ reason: z.string().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = declineInput.parse(await request.json().catch(() => ({})));
    const proposal = await declineProposal(actor, id, body.reason);
    return NextResponse.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}
