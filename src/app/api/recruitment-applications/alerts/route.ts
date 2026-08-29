import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listApplicationAlerts } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Subscriber- or holder-gated, enforced inside listApplicationAlerts.
export async function GET() {
  try {
    const actor = await requireMember();
    const alerts = await listApplicationAlerts(actor);
    return NextResponse.json({ alerts });
  } catch (err) {
    return errorResponse(err);
  }
}
