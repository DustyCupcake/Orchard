import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { submitQuestionResponse, submitQuestionResponseInput } from "@/lib/input-rounds";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; questionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { questionId } = await params;
    const body = submitQuestionResponseInput.parse(await request.json());
    const created = await submitQuestionResponse(actor, questionId, body);
    return NextResponse.json({ response: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
