import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Public — no actor. Sets a real session cookie on success, same as
// the ordinary magic-link verify route.
//
// The outcomes are returned distinctly rather than collapsed into a boolean,
// because they mean different things a client has to tell apart: a lane that
// admits straight away (`admitted`, which alone gets a session), a community
// check whose window is open (`check`), a lane that waits for an interview
// (`waiting`), and a lane that asks for an application first (`apply`). The
// ones that are in the funnel carry the private token their page lives at.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = redeemCommunityInviteInput.parse(await request.json());
    const outcome = await redeemCommunityInvite(token, body);
    if (outcome.kind === "admitted") {
      await createSession(outcome.memberId);
      // The JSON body's own `memberId` is all a client gets, so the
      // first-login hop has to be told rather than read off the outcome —
      // same rule the Server Action at src/app/invite/[token]/actions.ts
      // follows, and the reason the page is where a browser lands rather
      // than a redirect this route could have issued.
      return NextResponse.json(
        { ...outcome, redirectTo: outcome.redirectTo },
        { status: 201 },
      );
    }
    // check, waiting, apply: 202 with the outcome. No session is created —
    // they are not members yet.
    return NextResponse.json(outcome, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
