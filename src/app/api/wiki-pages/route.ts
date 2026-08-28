import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createWikiPage, createWikiPageInput, listWikiPages } from "@/lib/wiki-pages";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const branchId = request.nextUrl.searchParams.get("branchId") ?? undefined;
    const pages = await listWikiPages(actor, branchId);
    return NextResponse.json({ pages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createWikiPageInput.parse(await request.json());
    const created = await createWikiPage(actor, body);
    return NextResponse.json({ page: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
