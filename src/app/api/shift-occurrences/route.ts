import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listUpcomingShiftOccurrences } from "@/lib/shifts";

export const dynamic = "force-dynamic";

// Open to any member — the general browse surface for /shifts.
export async function GET() {
  try {
    const actor = await requireMember();
    const occurrences = await listUpcomingShiftOccurrences(actor);
    return NextResponse.json({ occurrences });
  } catch (err) {
    return errorResponse(err);
  }
}
