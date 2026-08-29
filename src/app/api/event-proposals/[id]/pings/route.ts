import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listMyEventProposalPings, pingConflictHost } from "@/lib/event-scheduling";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Submitter-only, enforced inside listMyEventProposalPings.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const pings = await listMyEventProposalPings(actor, id);
    return NextResponse.json({ pings });
  } catch (err) {
    return errorResponse(err);
  }
}

// Owner-only, enforced inside pingConflictHost.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const created = await pingConflictHost(actor, id);
    return NextResponse.json({ ping: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
