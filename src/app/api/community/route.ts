import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getCommunity, updateCommunity, updateCommunityInput } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const communityRow = await getCommunity(actor);
    return NextResponse.json({ community: communityRow });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = updateCommunityInput.parse(await request.json());
    const updated = await updateCommunity(actor, body);
    return NextResponse.json({ community: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
