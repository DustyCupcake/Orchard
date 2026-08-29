import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listPublishedSchedule, publishEventSchedule } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

// Open to any member — "readable by all members" once published.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const cycleIdParam = request.nextUrl.searchParams.get("cycleId");
    const cycleId = cycleIdParam === null ? undefined : cycleIdParam === "" ? null : cycleIdParam;
    const proposals = await listPublishedSchedule(actor, cycleId);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

// Owner-only, enforced inside publishEventSchedule.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = await request.json().catch(() => ({}));
    const cycleId: string | null | undefined =
      body && typeof body === "object" && "cycleId" in body ? (body.cycleId as string | null) : undefined;
    const result = await publishEventSchedule(actor, cycleId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
