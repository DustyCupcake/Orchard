import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getPoll } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const poll = await getPoll(actor, id);
    return NextResponse.json({ poll });
  } catch (err) {
    return errorResponse(err);
  }
}
