import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listApplicationsForEvaluation } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside listApplicationsForEvaluation.
export async function GET() {
  try {
    const actor = await requireMember();
    const applications = await listApplicationsForEvaluation(actor);
    return NextResponse.json({ applications });
  } catch (err) {
    return errorResponse(err);
  }
}
