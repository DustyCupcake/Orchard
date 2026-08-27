import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createTier, createTierInput, listTiers } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const tiers = await listTiers(actor);
    return NextResponse.json({ tiers });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createTierInput.parse(await request.json());
    const created = await createTier(actor, body);
    return NextResponse.json({ tier: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
