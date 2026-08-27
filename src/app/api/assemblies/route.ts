import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createAssembly, createAssemblyInput, listAssemblies } from "@/lib/assemblies";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const assemblies = await listAssemblies(actor);
    return NextResponse.json({ assemblies });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createAssemblyInput.parse(await request.json());
    const created = await createAssembly(actor, body);
    return NextResponse.json({ assembly: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
