import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getMyAvailability, submitAvailability, submitAvailabilityInput } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const slots = await getMyAvailability(actor, id);
    return NextResponse.json({ slots });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = submitAvailabilityInput.parse(await request.json());
    const entry = await submitAvailability(actor, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
