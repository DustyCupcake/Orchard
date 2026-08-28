import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { deleteSensitiveFieldAccessRule } from "@/lib/sensitive-data";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const { id } = await params;
    await deleteSensitiveFieldAccessRule(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
