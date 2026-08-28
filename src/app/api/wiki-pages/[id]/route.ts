import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getWikiPage } from "@/lib/wiki-pages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const result = await getWikiPage(actor, id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
