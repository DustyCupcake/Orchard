import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getMyRecruitmentSubscription, setRecruitmentSubscriptionActive } from "@/lib/recruitment";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireMember();
    const subscription = await getMyRecruitmentSubscription(actor);
    return NextResponse.json({ subscription });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = (await request.json()) as { active: boolean };
    const subscription = await setRecruitmentSubscriptionActive(actor, Boolean(body.active));
    return NextResponse.json({ subscription });
  } catch (err) {
    return errorResponse(err);
  }
}
