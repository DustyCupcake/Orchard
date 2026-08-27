import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createQuestion, createQuestionInput, listTaskQuestions } from "@/lib/input-rounds";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const questions = await listTaskQuestions(actor, id);
    return NextResponse.json({ questions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = createQuestionInput.parse(await request.json());
    const created = await createQuestion(actor, id, body);
    return NextResponse.json({ question: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
