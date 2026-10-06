import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { deleteConsentPurpose } from "@/lib/consent";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    await requireAdmins(actor);
    const { id } = await params;
    await deleteConsentPurpose(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
