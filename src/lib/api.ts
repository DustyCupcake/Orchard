import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentMember } from "./session";
import { AppError } from "./errors";
import { assertNotViewingAs } from "./view-as";

export async function requireMember() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    throw new AppError("Authentication required", 401);
  }
  return currentMember;
}

// What every mutating route handler (POST/PUT/PATCH/DELETE) calls instead
// of requireMember(). requireMember() is shared with GET handlers and with
// client-side reads, so it must keep working while View-as is on; a write
// must not. View-as is documented as strictly read-only — "disabled at the
// UI layer and re-checked/rejected server-side regardless" — and until this
// existed only the Server Actions honoured the second half: a REST write
// made during a View-as session went through as the support holder's own
// identity. That is not impersonation (it never acts as the viewed member)
// but it is a write in a mode that promises there are none, so the rule is
// now enforced where the write is, in one helper rather than 130 copies of
// an assert. tests/api-write-guard.test.ts fails if a mutating handler
// exists that neither uses this nor is on the public allowlist.
export async function requireWriteMember() {
  const currentMember = await requireMember();
  await assertNotViewingAs();
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
