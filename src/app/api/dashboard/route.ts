import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const [feed, snapshot] = await Promise.all([getPersonalFeed(actor), getCommunitySnapshot(actor)]);
    return NextResponse.json({ feed, snapshot });
  } catch (err) {
    return errorResponse(err);
  }
}
