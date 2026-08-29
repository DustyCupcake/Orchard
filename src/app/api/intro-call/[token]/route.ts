import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getIntroCallByToken } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Public — no actor. Only what the applicant needs to submit their
// own availability: the poll's title and date range, and the
// confirmed slot once one's been picked. Never the aggregate or
// anyone else's raw submission.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const found = await getIntroCallByToken(token);
    if (!found) {
      return NextResponse.json({ found: false });
    }
    const { poll } = found;
    return NextResponse.json({
      found: true,
      poll: {
        title: poll.title,
        rangeStart: poll.rangeStart,
        rangeEnd: poll.rangeEnd,
        confirmedSlotStart: poll.confirmedSlotStart,
        confirmedSlotEnd: poll.confirmedSlotEnd,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
