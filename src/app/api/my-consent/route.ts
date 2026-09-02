import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listMyConsentStatus } from "@/lib/consent";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const status = await listMyConsentStatus(actor);
    return NextResponse.json({ status });
  } catch (err) {
    return errorResponse(err);
  }
}
