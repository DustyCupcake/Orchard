import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { listConflictReportExclusions, recusePeer } from "@/lib/conflict";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const recusePeerInput = z.object({ memberId: z.string().uuid() });

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const exclusions = await listConflictReportExclusions(actor, id);
    return NextResponse.json({ exclusions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = recusePeerInput.parse(await request.json());
    const exclusion = await recusePeer(actor, id, body.memberId);
    return NextResponse.json({ exclusion }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
