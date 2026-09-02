import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { grantConsent } from "@/lib/consent";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const record = await grantConsent(actor, id, "explicit_action");
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
