import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { submitBudgetVote, submitBudgetVoteInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Open to any member — "every member can submit a full ranking plus a
// contribution signal." Replaceable in place, see submitBudgetVote.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = submitBudgetVoteInput.parse(await request.json());
    const vote = await submitBudgetVote(actor, id, body);
    return NextResponse.json({ vote });
  } catch (err) {
    return errorResponse(err);
  }
}
