import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { fileConflictReport, fileConflictReportInput, listConflictReports } from "@/lib/conflict";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const reports = await listConflictReports(actor);
    return NextResponse.json({ reports });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = fileConflictReportInput.parse(await request.json());
    const created = await fileConflictReport(actor, body);
    return NextResponse.json({ report: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
