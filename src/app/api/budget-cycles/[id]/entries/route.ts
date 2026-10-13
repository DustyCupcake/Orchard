import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { listBudgetEntries, recordEntry, recordEntryInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The entries the caller may see: all of them for the budget's holder, and only
// their own for anyone else (see listBudgetEntries).
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json(await listBudgetEntries(actor, id));
  } catch (err) {
    return errorResponse(err);
  }
}

// The holder records an expense or income, born confirmed; any other member
// adds an expense they paid for, born pending until the holder confirms it.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = recordEntryInput.parse(await request.json());
    return NextResponse.json({ entry: await recordEntry(actor, id, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
