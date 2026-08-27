import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { claimTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const task = await claimTask(actor, id);
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
