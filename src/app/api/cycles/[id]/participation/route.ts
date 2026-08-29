import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import {
  declareParticipation,
  declareParticipationInput,
  getCycleParticipationSummary,
  getMyParticipation,
} from "@/lib/participation";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const [summary, mine] = await Promise.all([
      getCycleParticipationSummary(actor, id),
      getMyParticipation(actor, id),
    ]);
    return NextResponse.json({ summary, mine });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = declareParticipationInput.parse(await request.json());
    const mine = await declareParticipation(actor, id, body);
    return NextResponse.json({ mine }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
