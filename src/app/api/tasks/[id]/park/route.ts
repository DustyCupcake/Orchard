import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMember, errorResponse } from "@/lib/api";
import { parkTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const parkInput = z.object({
  nextCheckinAt: z.string().datetime(),
  waitingNote: z.string().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = parkInput.parse(await request.json());
    const task = await parkTask(actor, id, {
      nextCheckinAt: new Date(body.nextCheckinAt),
      waitingNote: body.waitingNote,
    });
    return NextResponse.json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}
