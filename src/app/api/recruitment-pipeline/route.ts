import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getRecruitmentPipeline } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside getRecruitmentPipeline.
export async function GET() {
  try {
    const actor = await requireMember();
    const pipeline = await getRecruitmentPipeline(actor);
    return NextResponse.json(pipeline);
  } catch (err) {
    return errorResponse(err);
  }
}
