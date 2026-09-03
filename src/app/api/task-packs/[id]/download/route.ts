import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { exportTaskPackToFile } from "@/lib/task-packs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A downloadable JSON file — "a pack round-trips as a plain file,"
// same "link, don't host" posture Task Resources already established
// (see docs/spec.md's Task Pack) and the same download-not-email
// pattern Scheduling polls' own .ics invite route already uses.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const file = await exportTaskPackToFile(actor, id);
    return new NextResponse(JSON.stringify(file, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.name.replace(/[^a-z0-9]+/gi, "-")}.taskpack.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
