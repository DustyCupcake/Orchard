import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { markEntryReimbursed } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's holder only: an out-of-pocket expense has been paid back.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const entry = await markEntryReimbursed(actor, id);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
