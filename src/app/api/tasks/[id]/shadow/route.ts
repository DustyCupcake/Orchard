import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { claimAsShadow } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const assignment = await claimAsShadow(actor, id);
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
