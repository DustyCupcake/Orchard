import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Public — no actor. Sets a real session cookie on success, same as
// the ordinary magic-link verify route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = redeemCommunityInviteInput.parse(await request.json());
    const member = await redeemCommunityInvite(token, body);
    await createSession(member.id);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
