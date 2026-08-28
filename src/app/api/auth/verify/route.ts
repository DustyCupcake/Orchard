import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/magic-link";
import { findOrCreateMemberByEmail } from "@/lib/member";
import { getOrCreateCommunity } from "@/lib/community";
import { createSession } from "@/lib/session";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request);
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", appUrl));
  }

  const email = await consumeMagicLink(token);
  if (!email) {
    return NextResponse.redirect(new URL("/login?error=invalid_or_expired", appUrl));
  }

  const community = await getOrCreateCommunity();
  const memberRow = await findOrCreateMemberByEmail(community.id, email);
  await createSession(memberRow.id);

  return NextResponse.redirect(new URL("/dashboard", appUrl));
}
