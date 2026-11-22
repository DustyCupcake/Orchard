import { NextRequest, NextResponse } from "next/server";
import { requireMember, requireWriteMember, errorResponse } from "@/lib/api";
import { deleteShiftSeries, getShiftSeries, updateShiftSeries, updateShiftSeriesInput } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const series = await getShiftSeries(actor, id);
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}

// Manager-only, enforced inside updateShiftSeries.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = updateShiftSeriesInput.parse(await request.json());
    const series = await updateShiftSeries(actor, id, body);
    return NextResponse.json({ series });
  } catch (err) {
    return errorResponse(err);
  }
}

// Only while the roster's sign-ups are not open — see deleteShiftSeries.
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    await deleteShiftSeries(actor, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
