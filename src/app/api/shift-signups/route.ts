import { NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listMySignups } from "@/lib/shifts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const signups = await listMySignups(actor);
    return NextResponse.json({ signups });
  } catch (err) {
    return errorResponse(err);
  }
}
