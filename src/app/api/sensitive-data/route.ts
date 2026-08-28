import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getSensitiveDataTable, updateOwnSensitiveData, updateOwnSensitiveDataInput } from "@/lib/sensitive-data";

export const dynamic = "force-dynamic";

// Whatever fields the actor is currently unlocked for, every member's
// value — see docs/spec.md's Sensitive data.
export async function GET() {
  try {
    const actor = await requireMember();
    const table = await getSensitiveDataTable(actor);
    return NextResponse.json(table);
  } catch (err) {
    return errorResponse(err);
  }
}

// Always the actor's own values — see src/lib/sensitive-data.ts.
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = updateOwnSensitiveDataInput.parse(await request.json());
    const updated = await updateOwnSensitiveData(actor, body);
    return NextResponse.json({ member: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
