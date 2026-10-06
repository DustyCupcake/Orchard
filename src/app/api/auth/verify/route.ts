import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/magic-link";
import { findOrCreateMemberByEmail } from "@/lib/member";
import { getOrCreateCommunity } from "@/lib/community";
import { createSession } from "@/lib/session";
import { verifyOwnContactMethodByValue } from "@/lib/contact-methods";
import { firstLoginDestination } from "@/lib/first-login";
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
  const memberRow = await findOrCreateMemberByEmail(community, email);
  if (!memberRow) {
    return NextResponse.redirect(new URL("/login?error=no_account", appUrl));
  }

  // Consuming this token *is* the proof, and the three paths that seed an
  // unverified primary (invite, application, admin roster import) were all
  // leaving it that way for ever. An invitee whose address was typed by
  // somebody else, an applicant, and an admin's whole roster import all
  // reached a point where somebody clicked a link that could only have
  // arrived at the address it claims, and that fact was being thrown
  // away — leaving `verifiedAt` null and the member on /profile's
  // one-click "send me a confirmation" for a confirmation they had, in
  // effect, already given.
  //
  // Scoped to the member we just logged in as, not to the address: see
  // verifyOwnContactMethodByValue for why a bare address match would be
  // unsound. Best-effort — a failure here must not fail the login, since
  // the session is already valid and the worst case is the same null this
  // column has always had.
  await verifyOwnContactMethodByValue(memberRow.id, email).catch((err) => {
    console.error("[auth/verify] could not record proven delivery address:", err);
  });

  await createSession(memberRow.id);

  return NextResponse.redirect(new URL(firstLoginDestination(memberRow), appUrl));
}
