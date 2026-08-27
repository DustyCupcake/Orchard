import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addResource, addResourceInput, listResources } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const resources = await listResources(actor, id);
    return NextResponse.json({ resources });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addResourceInput.parse(await request.json());
    const created = await addResource(actor, id, body);
    return NextResponse.json({ resource: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
