import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { listBudgetEntries, recordEntry, recordEntryInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

// The community's own ledger. Only its holder sees or writes in it.
export async function GET() {
  try {
    const actor = await requireMember();
    return NextResponse.json(await listBudgetEntries(actor, null));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWriteMember();
    const body = recordEntryInput.parse(await request.json());
    return NextResponse.json({ entry: await recordEntry(actor, null, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
