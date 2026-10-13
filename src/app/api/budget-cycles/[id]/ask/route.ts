import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { updateBudgetCycle } from "@/lib/budget";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The owner sets what each person is asked to contribute to this event, or
// clears it with null. An average, not a bill. Owner-only and only while the
// budget is open, both enforced inside updateBudgetCycle.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const { contributionPerMember } = z
      .object({ contributionPerMember: z.number().int().nonnegative().nullable() })
      .parse(await request.json());
    const budget = await updateBudgetCycle(actor, id, { contributionPerMember });
    return NextResponse.json({ contributionPerMember: budget.contributionPerMember });
  } catch (err) {
    return errorResponse(err);
  }
}
