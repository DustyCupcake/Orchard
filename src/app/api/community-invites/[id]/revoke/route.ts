import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { revokeCommunityInvite } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Creator-only, enforced inside revokeCommunityInvite.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const invite = await revokeCommunityInvite(actor, id);
    return NextResponse.json({ invite });
  } catch (err) {
    return errorResponse(err);
  }
}
