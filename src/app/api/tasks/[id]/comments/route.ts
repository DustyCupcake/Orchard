import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addComment, addCommentInput, listComments } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const comments = await listComments(actor, id);
    return NextResponse.json({ comments });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addCommentInput.parse(await request.json());
    const created = await addComment(actor, id, body);
    return NextResponse.json({ comment: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
