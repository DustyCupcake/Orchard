import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { markWikiPageDuplicate, markWikiPageDuplicateInput } from "@/lib/wiki-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = markWikiPageDuplicateInput.parse(await request.json());
    const updated = await markWikiPageDuplicate(actor, id, body);
    return NextResponse.json({ page: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
