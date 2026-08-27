import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentMember } from "./session";
import { AppError } from "./errors";

export async function requireMember() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    throw new AppError("Authentication required", 401);
  }
  return currentMember;
}

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
  }
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
