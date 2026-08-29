import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getCycle, updateCycleSettings, updateCycleSettingsInput } from "@/lib/cycles";

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = updateCycleSettingsInput.parse(await request.json());
    const cycle = await updateCycleSettings(actor, id, body);
    return NextResponse.json({ cycle });
  } catch (err) {
    return errorResponse(err);
  }
}
