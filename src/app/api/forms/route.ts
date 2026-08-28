import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createForm, createFormInput, listForms } from "@/lib/forms";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const forms = await listForms(actor, { includeArchived });
    return NextResponse.json({ forms });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const body = createFormInput.parse(await request.json());
    const created = await createForm(actor, body);
    return NextResponse.json({ form: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
