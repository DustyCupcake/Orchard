import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listAttendance, recordAttendance, recordAttendanceInput } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const attendance = await listAttendance(actor, id);
    return NextResponse.json({ attendance });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = recordAttendanceInput.parse(await request.json());
    const record = await recordAttendance(actor, id, body);
    return NextResponse.json({ record });
  } catch (err) {
    return errorResponse(err);
  }
}
