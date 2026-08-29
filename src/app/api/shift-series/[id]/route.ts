import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getShiftSeries } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const series = await getShiftSeries(actor, id);
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}
