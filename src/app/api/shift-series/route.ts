import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createShiftSeries, createShiftSeriesInput, listShiftSeries } from "@/lib/shifts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const series = await listShiftSeries(actor, { includeArchived });
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}

// Open to any member — see src/lib/shifts/series.ts's createShiftSeries.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createShiftSeriesInput.parse(await request.json());
    const created = await createShiftSeries(actor, body);
    return NextResponse.json({ series: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
