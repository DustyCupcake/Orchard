import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { addAgendaItem, addAgendaItemInput, listAgendaItems } from "@/lib/scheduling-polls";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const items = await listAgendaItems(actor, id);
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = addAgendaItemInput.parse(await request.json());
    const created = await addAgendaItem(actor, id, body);
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
