import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { setOutgoing } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const setOutgoingInput = z.object({ outgoing: z.boolean() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = setOutgoingInput.parse(await request.json());
    const assignment = await setOutgoing(actor, id, body.outgoing);
    return NextResponse.json({ assignment });
  } catch (err) {
    return errorResponse(err);
  }
}
