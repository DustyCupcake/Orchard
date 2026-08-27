import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createRequirement, createRequirementInput, listRequirements } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const requirements = await listRequirements(actor, id);
    return NextResponse.json({ requirements });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = createRequirementInput.parse(await request.json());
    const created = await createRequirement(actor, id, body);
    return NextResponse.json({ requirement: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
