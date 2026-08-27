import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getSummary, saveSummary, saveSummaryInput } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const summary = await getSummary(actor, id);
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = saveSummaryInput.parse(await request.json());
    const summary = await saveSummary(actor, id, body);
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err);
  }
}
