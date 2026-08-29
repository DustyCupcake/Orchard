import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getMySpacePreference, upsertMySpacePreference } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Self-service — always the caller's own row, no id in the URL.
export async function GET() {
  try {
    const actor = await requireMember();
    const preference = await getMySpacePreference(actor);
    return NextResponse.json({ preference });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = await request.json();
    const preference = await upsertMySpacePreference(actor, body);
    return NextResponse.json({ preference });
  } catch (err) {
    return errorResponse(err);
  }
}
