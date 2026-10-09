import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { getStandingAvailability, requireRecruitmentTaskHolder, setStandingAvailability } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// A holder's own standing grid (docs/admission-flow.md §2): one grid, read by
// every incoming interview as it stands, edited whenever they like.
export async function GET() {
  try {
    const actor = await requireMember();
    const row = await getStandingAvailability(actor.id);
    return NextResponse.json({ slots: (row?.availableSlots as string[] | undefined) ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWriteMember();
    await requireRecruitmentTaskHolder(actor);
    const body = z.object({ slots: z.array(z.string().datetime()) }).parse(await request.json());
    const row = await setStandingAvailability(actor.id, body.slots);
    return NextResponse.json({ entry: { availableSlots: row.availableSlots } });
  } catch (err) {
    return errorResponse(err);
  }
}
