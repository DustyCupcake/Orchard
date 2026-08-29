import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { resolveWiderDiscussionInput, resolveWiderDiscussionManually } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside resolveWiderDiscussionManually — the
// human-call escape hatch for an objected (or otherwise not worth
// waiting out) wider-discussion window.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = resolveWiderDiscussionInput.parse(await request.json());
    const decision = await resolveWiderDiscussionManually(actor, id, body);
    return NextResponse.json({ decision });
  } catch (err) {
    return errorResponse(err);
  }
}
