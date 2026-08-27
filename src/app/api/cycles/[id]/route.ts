import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getCycle } from "@/lib/cycles";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const cycle = await getCycle(actor, id);
    return NextResponse.json({ cycle });
  } catch (err) {
    return errorResponse(err);
  }
}
