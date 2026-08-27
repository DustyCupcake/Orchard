import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { generateIcs, getPoll } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A downloadable calendar invite — see resolve.ts's generateIcs()
// comment for why this is a pull (download) rather than an outbound
// email.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const poll = await getPoll(actor, id);
    const ics = generateIcs(poll);
    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${poll.title.replace(/[^a-z0-9]+/gi, "-")}.ics"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
