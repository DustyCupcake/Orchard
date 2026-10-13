import { NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { getBudgetMoney } from "@/lib/budget";

export const dynamic = "force-dynamic";

// The community budget's totals: balance, committed and available. Open to
// every member.
export async function GET() {
  try {
    const actor = await requireMember();
    return NextResponse.json({ money: await getBudgetMoney(actor, null) });
  } catch (err) {
    return errorResponse(err);
  }
}
