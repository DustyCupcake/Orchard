import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { acceptJoinRequest } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; requestId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id, requestId } = await params;
    const task = await acceptJoinRequest(actor, id, requestId);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
