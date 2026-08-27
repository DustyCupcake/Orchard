import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { expressCandidacy, listCandidacies } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const candidacies = await listCandidacies(actor, id);
    return NextResponse.json({ candidacies });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const candidacy = await expressCandidacy(actor, id);
    return NextResponse.json({ candidacy }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
