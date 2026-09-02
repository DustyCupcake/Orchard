import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { activateEmergencyAccess, listEmergencyAccessActivity } from "@/lib/emergency-access";

export const dynamic = "force-dynamic";

const activateInput = z.object({
  targetMemberId: z.string().uuid(),
  explanation: z.string().optional(),
});

// GET: the actor's own activity, both as activator and target — see
// docs/spec.md's "both parties notified."
export async function GET() {
  try {
    const actor = await requireMember();
    const activity = await listEmergencyAccessActivity(actor);
    return NextResponse.json({ activity });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = activateInput.parse(await request.json());
    const { log, methods } = await activateEmergencyAccess(actor, body.targetMemberId, body.explanation);
    return NextResponse.json({ log, methods }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
