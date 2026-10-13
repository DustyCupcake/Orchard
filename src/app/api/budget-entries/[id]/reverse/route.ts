import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { reverseEntry, reverseEntryInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's holder only. Records an adjustment for the opposite amount and leaves the original visible.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = reverseEntryInput.parse(await request.json().catch(() => ({})));
    const entry = await reverseEntry(actor, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
