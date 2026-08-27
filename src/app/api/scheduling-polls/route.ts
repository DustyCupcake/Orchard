import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createPoll, createPollInput, listPolls } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const polls = await listPolls(actor);
    return NextResponse.json({ polls });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createPollInput.parse(await request.json());
    const created = await createPoll(actor, body);
    return NextResponse.json({ poll: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
