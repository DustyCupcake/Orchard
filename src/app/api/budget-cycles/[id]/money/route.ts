import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { getBudgetMoney } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// An event's totals — balance, income, spent, and planned against spent per
// approved proposal. Open to every member; it names no one and no entry.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ money: await getBudgetMoney(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
