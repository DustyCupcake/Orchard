import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addAgendaItem, addAgendaItemInput } from "@/lib/assemblies";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addAgendaItemInput.parse(await request.json());
    const created = await addAgendaItem(actor, id, body);
    return NextResponse.json({ agendaItem: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
