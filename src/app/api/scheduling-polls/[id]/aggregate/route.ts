import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getPollAggregate } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const aggregate = await getPollAggregate(actor, id);
    return NextResponse.json(aggregate);
  } catch (err) {
    return errorResponse(err);
  }
}
