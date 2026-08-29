import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { communityInviteStatus, getCommunityInviteByToken } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Public — just the computed status, never the raw invite row (which
// would leak who created it / who redeemed it to an unauthenticated
// caller).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await getCommunityInviteByToken(token);
    return NextResponse.json({ status: communityInviteStatus(invite) });
  } catch (err) {
    return errorResponse(err);
  }
}
