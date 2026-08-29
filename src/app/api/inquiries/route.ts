import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getOrCreateCommunity } from "@/lib/community";
import { listInquiries, submitInquiry, submitInquiryInput } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Recruitment-task-holder-gated, enforced inside listInquiries.
export async function GET() {
  try {
    const actor = await requireMember();
    const inquiries = await listInquiries(actor);
    return NextResponse.json({ inquiries });
  } catch (err) {
    return errorResponse(err);
  }
}

// Public — no actor. Single-tenant deployment, same as every other
// public entry point (see src/lib/community.ts's getOrCreateCommunity).
export async function POST(request: NextRequest) {
  try {
    const community = await getOrCreateCommunity();
    const body = submitInquiryInput.parse(await request.json());
    const created = await submitInquiry(community.id, body);
    return NextResponse.json({ inquiry: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
