import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { unarchiveShiftSeries } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Coordinator-only, enforced inside unarchiveShiftSeries.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const series = await unarchiveShiftSeries(actor, id);
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}
