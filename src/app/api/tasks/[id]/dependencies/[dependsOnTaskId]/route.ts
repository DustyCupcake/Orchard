import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { removeTaskDependency } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; dependsOnTaskId: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id, dependsOnTaskId } = await params;
    await removeTaskDependency(actor, id, dependsOnTaskId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
