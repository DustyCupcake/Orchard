import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
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
    // The one REST route this codebase's View-as feature (Phase 54)
    // reaches into: AvailabilityGrid.tsx (the one deliberate
    // pointer-events + fetch() client component, Phase 19) posts here
    // directly rather than through a Server Action, so it can't be
    // caught by the shadow-requireMember() guard every actions.ts file
    // uses. Every other REST route stays untouched by View-as on
    // purpose — see src/lib/view-as.ts's own comment — but this one is
    // a dedicated write-only endpoint, not a route real read traffic
    // shares, so guarding it here carries none of that risk.
    await assertNotViewingAs();
    const { id } = await params;
    const body = submitAvailabilityInput.parse(await request.json());
    const entry = await submitAvailability(actor, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
