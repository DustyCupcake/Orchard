import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listTaskWikiIndex } from "@/lib/wiki-pages";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const groups = await listTaskWikiIndex(actor);
    return NextResponse.json({ groups });
  } catch (err) {
    return errorResponse(err);
  }
}
