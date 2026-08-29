import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createCommunityInvite, createCommunityInviteInput, listMyCommunityInvites } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const invites = await listMyCommunityInvites(actor);
    return NextResponse.json({ invites });
  } catch (err) {
    return errorResponse(err);
  }
}

// Open to any member — generating an invite is a unilateral act, no
// approval gate. requireModuleEnabled inside createCommunityInvite
// still blocks it while Recruitment is off.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createCommunityInviteInput.parse(await request.json());
    const invite = await createCommunityInvite(actor, body);
    return NextResponse.json({ invite }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
