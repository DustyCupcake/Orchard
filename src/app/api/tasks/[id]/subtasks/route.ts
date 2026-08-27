import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listSubtasks, splitSubtask, splitSubtaskInput } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const subtasks = await listSubtasks(actor, id);
    return NextResponse.json({ subtasks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = splitSubtaskInput.parse(await request.json());
    const created = await splitSubtask(actor, id, body);
    return NextResponse.json({ task: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
