import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { setBudgetProposalSupport } from "@/lib/budget";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Back a proposal, or take that back. One per member; the proposer is already
// behind their own.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const { supporting } = z.object({ supporting: z.boolean() }).parse(await request.json());
    return NextResponse.json({ supporting: await setBudgetProposalSupport(actor, id, supporting) });
  } catch (err) {
    return errorResponse(err);
  }
}
