import { NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { resolveBrowsePeriods } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// Runs the same job the scheduler ticks every few minutes, on demand —
// useful for verification, matching /api/attention/recompute's pattern.
export async function POST() {
  try {
    await requireWriteMember();
    const result = await resolveBrowsePeriods();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
