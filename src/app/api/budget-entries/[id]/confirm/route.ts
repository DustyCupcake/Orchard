import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { confirmEntry } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's holder only — enforced inside confirmEntry.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const entry = await confirmEntry(actor, id);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
