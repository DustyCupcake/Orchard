import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getOwnContribution, updateContributionVisibility, updateContributionVisibilityInput } from "@/lib/contribution";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const categories = await getOwnContribution(actor);
    return NextResponse.json({ categories });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = updateContributionVisibilityInput.parse(await request.json());
    const updated = await updateContributionVisibility(actor, body);
    return NextResponse.json({ member: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
