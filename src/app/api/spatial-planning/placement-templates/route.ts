import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createPlacementTemplate, listPlacementTemplates } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const templates = await listPlacementTemplates(actor);
    return NextResponse.json({ templates });
  } catch (err) {
    return errorResponse(err);
  }
}

// Holder-gated inside createPlacementTemplate.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = await request.json();
    const created = await createPlacementTemplate(actor, body);
    return NextResponse.json({ template: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
