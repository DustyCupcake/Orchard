import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { rotateTaskIntoShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The standing scope's shift manager's act, enforced inside
// rotateTaskIntoShift (D10) — a one-click action, no body of its own.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const series = await rotateTaskIntoShift(actor, id);
    return NextResponse.json({ series }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
