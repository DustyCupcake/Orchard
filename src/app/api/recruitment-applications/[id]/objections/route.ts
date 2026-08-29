import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listObjections, raiseObjection, raiseObjectionInput } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Holder-only, enforced inside listObjections. raisedBy is never
// included — see listObjections' own comment.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const objections = await listObjections(actor, id);
    return NextResponse.json({ objections });
  } catch (err) {
    return errorResponse(err);
  }
}

// Subscriber-gated, enforced inside raiseObjection.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = raiseObjectionInput.parse(await request.json());
    const created = await raiseObjection(actor, id, body);
    return NextResponse.json({ objection: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
