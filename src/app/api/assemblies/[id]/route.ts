import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getAssembly } from "@/lib/assemblies";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const assembly = await getAssembly(actor, id);
    return NextResponse.json({ assembly });
  } catch (err) {
    return errorResponse(err);
  }
}
