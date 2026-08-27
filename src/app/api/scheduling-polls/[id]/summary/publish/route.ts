import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { publishSummary } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const summary = await publishSummary(actor, id);
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err);
  }
}
