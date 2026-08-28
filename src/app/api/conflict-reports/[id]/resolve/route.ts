import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { resolveConflictReport, resolveConflictReportInput } from "@/lib/conflict";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = resolveConflictReportInput.parse(await request.json());
    const report = await resolveConflictReport(actor, id, body);
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}
