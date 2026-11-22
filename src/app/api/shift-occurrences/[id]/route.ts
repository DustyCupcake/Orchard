import { NextRequest, NextResponse } from "next/server";
import { requireMember, requireWriteMember, errorResponse } from "@/lib/api";
import { deleteShiftOccurrence, getShiftOccurrence, updateShiftOccurrence, updateShiftOccurrenceInput } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const result = await getShiftOccurrence(actor, id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

// Manager-only, enforced inside updateShiftOccurrence.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = updateShiftOccurrenceInput.parse(await request.json());
    const occurrence = await updateShiftOccurrence(actor, id, body);
    return NextResponse.json({ occurrence });
  } catch (err) {
    return errorResponse(err);
  }
}

// Only while the roster's sign-ups are not open — see deleteShiftOccurrence.
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    await deleteShiftOccurrence(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
