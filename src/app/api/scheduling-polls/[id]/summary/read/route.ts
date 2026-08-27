import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getSummary, markSummaryRead } from "@/lib/scheduling-polls";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const summary = await getSummary(actor, id);
    if (!summary) {
      throw new NotFoundError("No summary written yet");
    }
    const read = await markSummaryRead(actor, summary.id);
    return NextResponse.json({ read });
  } catch (err) {
    return errorResponse(err);
  }
}
