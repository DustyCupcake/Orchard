import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Public — no actor. Sets a real session cookie on success, same as
// the ordinary magic-link verify route.
//
// The four outcomes of docs/joining-admission-plan.md §2 are all
// returned distinctly rather than collapsed into a boolean, because
// three of them mean "not yet a member" in three different ways a
// client has to tell apart: a nomination still collecting support, a
// consensus arrival whose community check hasn't closed, and a lane
// that funnels into the application. Only `member` gets a session, and
// the two window outcomes carry the token/handle the client needs to
// render the right follow-up.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = redeemCommunityInviteInput.parse(await request.json());
    const outcome = await redeemCommunityInvite(token, body);
    if (outcome.kind === "member") {
      await createSession(outcome.memberId);
    }
    return NextResponse.json(outcome, { status: outcome.kind === "member" ? 201 : 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
