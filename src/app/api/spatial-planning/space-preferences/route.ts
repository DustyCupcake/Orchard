import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listSpacePreferences } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Holder-only inside listSpacePreferences — "visible to whoever's
// drawing the layout," not a community-wide roster.
export async function GET() {
  try {
    const actor = await requireMember();
    const preferences = await listSpacePreferences(actor);
    return NextResponse.json({ preferences });
  } catch (err) {
    return errorResponse(err);
  }
}
