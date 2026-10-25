import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { getArrivalByToken, getInterviewAvailability, submitInterviewAvailability } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Public — no actor; the person's private token is the credential. Their own
// submission, safe to show back to them for pre-fill on reopen.
async function arrivalOr404(token: string) {
  const arrival = await getArrivalByToken(token);
  if (!arrival) throw new NotFoundError("Request not found");
  return arrival;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return NextResponse.json({ slots: await getInterviewAvailability(await arrivalOr404(token)) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = z.object({ slots: z.array(z.string().datetime()) }).parse(await request.json());
    const entry = await submitInterviewAvailability(await arrivalOr404(token), body.slots);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
