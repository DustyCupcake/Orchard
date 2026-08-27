import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { confirmSlot, confirmSlotInput } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = confirmSlotInput.parse(await request.json());
    const poll = await confirmSlot(actor, id, body);
    return NextResponse.json({ poll });
  } catch (err) {
    return errorResponse(err);
  }
}
