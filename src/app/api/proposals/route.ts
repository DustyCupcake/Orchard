import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createProposal, createProposalInput, listProposals } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const proposals = await listProposals(actor, { status });
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = createProposalInput.parse(await request.json());
    const created = await createProposal(actor, body);
    return NextResponse.json({ proposal: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
