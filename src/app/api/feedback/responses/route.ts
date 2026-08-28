import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listPostCycleFeedbackResponses } from "@/lib/forms";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const responses = await listPostCycleFeedbackResponses(actor);
    return NextResponse.json({ responses });
  } catch (err) {
    return errorResponse(err);
  }
}
