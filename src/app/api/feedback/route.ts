import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getPostCycleFeedbackForm, submitFormResponseInput, submitPostCycleFeedback } from "@/lib/forms";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const form = await getPostCycleFeedbackForm(actor);
    return NextResponse.json({ form });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = submitFormResponseInput.parse(await request.json());
    const created = await submitPostCycleFeedback(actor, body);
    return NextResponse.json({ response: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
