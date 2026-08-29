import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import {
  getIntroCallAvailability,
  submitIntroCallAvailability,
  submitIntroCallAvailabilityInput,
} from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Public — no actor. The applicant's own submission, safe to show
// back to them for pre-fill on reopen (same posture the member-facing
// getMyAvailability already takes).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const slots = await getIntroCallAvailability(token);
    return NextResponse.json({ slots });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = submitIntroCallAvailabilityInput.parse(await request.json());
    const entry = await submitIntroCallAvailability(token, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
