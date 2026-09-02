import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { contactMethodInput, createContactMethod, listOwnContactMethods } from "@/lib/contact-methods";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const methods = await listOwnContactMethods(actor);
    return NextResponse.json({ methods });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = contactMethodInput.parse(await request.json());
    const created = await createContactMethod(actor, body);
    return NextResponse.json({ method: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
