import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listOutboundMessagesVisibleTo, sendMessageInput, sendOutboundMessage } from "@/lib/messages";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const messages = await listOutboundMessagesVisibleTo(actor);
    return NextResponse.json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = sendMessageInput.parse(await request.json());
    const created = await sendOutboundMessage(actor, body);
    return NextResponse.json({ message: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
