import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createTask, createTaskInput, listTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const { searchParams } = request.nextUrl;
    const tasks = await listTasks(actor, {
      branchId: searchParams.get("branchId") ?? undefined,
      cycleId: searchParams.get("cycleId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createTaskInput.parse(await request.json());
    const created = await createTask(actor, body);
    return NextResponse.json({ task: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
