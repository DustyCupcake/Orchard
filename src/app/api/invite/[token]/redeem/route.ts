import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";
import { firstLoginDestinationFor } from "@/lib/first-login";

export const dynamic = "force-dynamic";

// Public — no actor. Sets a real session cookie on success, same as
// the ordinary magic-link verify route.
//
// The four outcomes of docs/plans/archive/joining-admission-plan.md §2 are all
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
      // The JSON body's own `memberId` is all a client gets, so the
      // first-login hop has to be told rather than read off the outcome —
      // same rule the Server Action at src/app/invite/[token]/actions.ts
      // follows, and the reason the page is where a browser lands rather
      // than a redirect this route could have issued.
      return NextResponse.json(
        { ...outcome, redirectTo: await firstLoginDestinationFor(outcome.memberId) },
        { status: 201 },
      );
    }
    return NextResponse.json(outcome, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
