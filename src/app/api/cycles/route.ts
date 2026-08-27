import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createCycle, createCycleInput, listCycles } from "@/lib/cycles";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const cycles = await listCycles(actor);
    return NextResponse.json({ cycles });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createCycleInput.parse(await request.json());
    const created = await createCycle(actor, body);
    return NextResponse.json({ cycle: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
