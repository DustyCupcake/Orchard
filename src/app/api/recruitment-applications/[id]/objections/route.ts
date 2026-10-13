import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listConcerns } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside listConcerns. raisedById is never included — it is
// the shield (docs/plans/admission-flow.md §5). Raising a concern is its own route, on the
// arrival: POST /api/community-check/[arrivalId]/concerns.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const objections = await listConcerns(actor, id);
    return NextResponse.json({ objections });
  } catch (err) {
    return errorResponse(err);
  }
}
