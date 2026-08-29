import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { archiveShiftSeries } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Coordinator-only, enforced inside archiveShiftSeries.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const series = await archiveShiftSeries(actor, id);
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}
