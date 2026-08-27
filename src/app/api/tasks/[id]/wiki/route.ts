import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addWikiRevision, addWikiRevisionInput, listWikiRevisions } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const revisions = await listWikiRevisions(actor, id);
    return NextResponse.json({ revisions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addWikiRevisionInput.parse(await request.json());
    const created = await addWikiRevision(actor, id, body);
    return NextResponse.json({ revision: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
