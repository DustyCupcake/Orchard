import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listFormResponses, submitFormResponse, submitFormResponseInput } from "@/lib/forms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Community-scoped only — see src/lib/forms.ts's listFormResponses.
// A consumer with its own review-authority gating (post-cycle
// feedback's feedbackReviewTaskId) exposes its own narrower route
// instead — see /api/feedback/responses.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const responses = await listFormResponses(actor, id);
    return NextResponse.json({ responses });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = submitFormResponseInput.parse(await request.json());
    const created = await submitFormResponse(actor, id, body);
    return NextResponse.json({ response: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
