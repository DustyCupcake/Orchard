import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addTaskDependency, addTaskDependencyInput, listTaskDependencies } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const dependencies = await listTaskDependencies(actor, id);
    return NextResponse.json({ dependencies });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addTaskDependencyInput.parse(await request.json());
    const created = await addTaskDependency(actor, id, body.dependsOnTaskId);
    return NextResponse.json({ dependency: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
