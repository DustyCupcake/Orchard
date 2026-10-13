import { NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { getContributionSummary } from "@/lib/budget";

export const dynamic = "force-dynamic";

// What has been given to the community's own budget. The total is open to every
// member; who gave what is the community budget's holder's, and each member sees
// their own.
export async function GET() {
  try {
    const actor = await requireMember();
    return NextResponse.json({ contributions: await getContributionSummary(actor, null) });
  } catch (err) {
    return errorResponse(err);
  }
}
