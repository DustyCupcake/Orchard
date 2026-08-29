import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { savePlacementAsTemplate } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const { name } = await request.json();
    if (!name) throw new AppError("name is required");
    const created = await savePlacementAsTemplate(actor, id, name);
    return NextResponse.json({ template: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
