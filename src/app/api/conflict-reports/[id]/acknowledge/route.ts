import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { acknowledgeConflictReport } from "@/lib/conflict";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const report = await acknowledgeConflictReport(actor, id);
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}
