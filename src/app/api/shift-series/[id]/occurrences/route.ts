import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import {
  generateShiftOccurrences,
  generateShiftOccurrencesInput,
  listOccurrencesForSeries,
} from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Coordinator-only, enforced inside listOccurrencesForSeries — every
// occurrence for this series, past and future.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const occurrences = await listOccurrencesForSeries(actor, id);
    return NextResponse.json({ occurrences });
  } catch (err) {
    return errorResponse(err);
  }
}

// Coordinator-only, enforced inside generateShiftOccurrences.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = generateShiftOccurrencesInput.parse(await request.json());
    const created = await generateShiftOccurrences(actor, id, body);
    return NextResponse.json({ occurrences: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
