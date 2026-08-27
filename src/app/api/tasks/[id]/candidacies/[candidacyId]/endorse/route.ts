import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { endorseCandidacy } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; candidacyId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id, candidacyId } = await params;
    const result = await endorseCandidacy(actor, id, candidacyId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
