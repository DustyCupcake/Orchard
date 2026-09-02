import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getVisibleContactMethods } from "@/lib/contact-methods";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The other members' side of things — resolved per-method against
// src/lib/contact-methods.ts's task_or_group_mates/everyone rules.
// emergency_only methods never surface here; see /api/emergency-access.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const methods = await getVisibleContactMethods(actor, id);
    return NextResponse.json({ methods });
  } catch (err) {
    return errorResponse(err);
  }
}
