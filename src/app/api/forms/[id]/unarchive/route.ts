import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { unarchiveForm } from "@/lib/forms";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const { id } = await params;
    const updated = await unarchiveForm(actor, id);
    return NextResponse.json({ form: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
