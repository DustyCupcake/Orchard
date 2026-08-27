import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { deleteRequirement, updateRequirement, updateRequirementInput } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; requirementId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id, requirementId } = await params;
    const body = updateRequirementInput.parse(await request.json());
    const updated = await updateRequirement(actor, id, requirementId, body);
    return NextResponse.json({ requirement: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id, requirementId } = await params;
    await deleteRequirement(actor, id, requirementId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
