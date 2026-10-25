import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { recordArrivalDecisionIfReached, submitArrivalEvaluation, submitEvaluationInput } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// A report about an arrival, whether or not it sent an application — which is what a
// lane that asks only for a conversation has. Holder-only, enforced inside
// submitArrivalEvaluation. recordArrivalDecisionIfReached is idempotent — safe to
// call after every report.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = submitEvaluationInput.parse(await request.json());
    const created = await submitArrivalEvaluation(actor, id, body);
    const decision = await recordArrivalDecisionIfReached(actor, id);
    return NextResponse.json({ evaluation: created, decision });
  } catch (err) {
    return errorResponse(err);
  }
}
