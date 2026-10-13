import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { rejectEntry, rejectEntryInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's holder only. The row is kept, marked rejected.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = rejectEntryInput.parse(await request.json().catch(() => ({})));
    const entry = await rejectEntry(actor, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
