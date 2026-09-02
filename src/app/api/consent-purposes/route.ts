import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createConsentPurpose, createConsentPurposeInput, listConsentPurposes } from "@/lib/consent";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Read stays open to any member — they need to see a purpose before
// they can meaningfully grant or withdraw consent against it.
export async function GET() {
  try {
    const actor = await requireMember();
    const purposes = await listConsentPurposes(actor);
    return NextResponse.json({ purposes });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const body = createConsentPurposeInput.parse(await request.json());
    const created = await createConsentPurpose(actor, body);
    return NextResponse.json({ purpose: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
