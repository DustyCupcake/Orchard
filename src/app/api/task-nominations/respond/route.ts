import { NextRequest, NextResponse } from "next/server";
import { respondToNominationByToken } from "@/lib/tasks";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

// Public, no login — the one-click email action link itself. Each
// token was already issued bound to exactly one response
// (accept/decline/not_now — see src/lib/tasks/nominations.ts), so a GET
// here (what an emailed link naturally is) is safe to treat as the
// actual action, the same way clicking a magic link is.
export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request);
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/nomination-response?status=invalid", appUrl));
  }

  const updated = await respondToNominationByToken(token);
  if (!updated) {
    return NextResponse.redirect(new URL("/nomination-response?status=invalid", appUrl));
  }

  return NextResponse.redirect(new URL(`/nomination-response?status=${updated.status}`, appUrl));
}
