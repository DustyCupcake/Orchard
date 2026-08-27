import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listJoinRequests } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const requests = await listJoinRequests(actor, id);
    return NextResponse.json({ requests });
  } catch (err) {
    return errorResponse(err);
  }
}
