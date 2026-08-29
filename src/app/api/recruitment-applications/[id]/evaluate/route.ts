import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { recordDecisionIfReached, submitEvaluation, submitEvaluationInput } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside submitEvaluation. recordDecisionIfReached
// is idempotent — safe to call after every evaluation.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = submitEvaluationInput.parse(await request.json());
    const created = await submitEvaluation(actor, id, body);
    const decision = await recordDecisionIfReached(actor, id);
    return NextResponse.json({ evaluation: created, decision });
  } catch (err) {
    return errorResponse(err);
  }
}
