import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getOrCreateCommunity } from "@/lib/community";
import {
  getRecruitmentApplicationFormPublic,
  submitRecruitmentApplication,
  submitRecruitmentApplicationInput,
} from "@/lib/recruitment";

export const dynamic = "force-dynamic";

// Public — no actor.
export async function GET() {
  try {
    const community = await getOrCreateCommunity();
    const form = await getRecruitmentApplicationFormPublic(community.id);
    return NextResponse.json({ form });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const community = await getOrCreateCommunity();
    const body = submitRecruitmentApplicationInput.parse(await request.json());
    const response = await submitRecruitmentApplication(community.id, body);
    return NextResponse.json({ response }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
