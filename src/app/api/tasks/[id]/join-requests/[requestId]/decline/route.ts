import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { declineJoinRequest, declineJoinRequestInput } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; requestId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id, requestId } = await params;
    const body = declineJoinRequestInput.parse(await request.json().catch(() => ({})));
    const declined = await declineJoinRequest(actor, id, requestId, body);
    return NextResponse.json({ request: declined });
  } catch (err) {
    return errorResponse(err);
  }
}
