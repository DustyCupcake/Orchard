import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { resolveInquiry } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Recruitment-task-holder-gated, enforced inside resolveInquiry.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const inquiry = await resolveInquiry(actor, id);
    return NextResponse.json({ inquiry });
  } catch (err) {
    return errorResponse(err);
  }
}
