import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { addEmergencyAccessExplanation } from "@/lib/emergency-access";

export const dynamic = "force-dynamic";

const explanationInput = z.object({ explanation: z.string().min(1) });

type Params = { params: Promise<{ id: string }> };

// "Can be added after the fact rather than blocking the moment" —
// activator-only, any time.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = explanationInput.parse(await request.json());
    const updated = await addEmergencyAccessExplanation(actor, id, body.explanation);
    return NextResponse.json({ log: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
