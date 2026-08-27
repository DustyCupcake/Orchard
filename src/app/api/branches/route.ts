import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createBranch, createBranchInput, listBranches } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const branches = await listBranches(actor);
    return NextResponse.json({ branches });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createBranchInput.parse(await request.json());
    const created = await createBranch(actor, body);
    return NextResponse.json({ branch: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
