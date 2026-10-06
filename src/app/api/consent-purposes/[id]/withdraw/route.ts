import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { withdrawConsent } from "@/lib/consent";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const record = await withdrawConsent(actor, id);
    return NextResponse.json({ record });
  } catch (err) {
    return errorResponse(err);
  }
}
