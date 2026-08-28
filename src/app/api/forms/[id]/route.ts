import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getForm, updateForm, updateFormInput } from "@/lib/forms";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const form = await getForm(actor, id);
    return NextResponse.json({ form });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const { id } = await params;
    const body = updateFormInput.parse(await request.json());
    const updated = await updateForm(actor, id, body);
    return NextResponse.json({ form: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
