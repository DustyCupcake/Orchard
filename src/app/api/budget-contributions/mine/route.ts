import { NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { listMyContributions } from "@/lib/budget";

export const dynamic = "force-dynamic";

// Everything the caller has paid in, across events and the community's budget,
// grouped by what it was for. Their own data and nobody else's.
export async function GET() {
  try {
    const actor = await requireMember();
    return NextResponse.json({ groups: await listMyContributions(actor) });
  } catch (err) {
    return errorResponse(err);
  }
}
