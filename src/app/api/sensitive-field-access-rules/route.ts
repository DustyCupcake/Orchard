import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import {
  createSensitiveFieldAccessRule,
  createSensitiveFieldAccessRuleInput,
  listSensitiveFieldAccessRules,
} from "@/lib/sensitive-data";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const rules = await listSensitiveFieldAccessRules(actor);
    return NextResponse.json({ rules });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const body = createSensitiveFieldAccessRuleInput.parse(await request.json());
    const created = await createSensitiveFieldAccessRule(actor, body);
    return NextResponse.json({ rule: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
