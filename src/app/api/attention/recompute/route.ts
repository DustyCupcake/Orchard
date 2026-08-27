import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { recomputeAttentionLevels } from "@/lib/attention";

export const dynamic = "force-dynamic";

// Runs the same job the scheduler ticks every few minutes, on demand —
// useful for verification, and a reasonable "run now" for later.
export async function POST() {
  try {
    await requireMember();
    const result = await recomputeAttentionLevels();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
