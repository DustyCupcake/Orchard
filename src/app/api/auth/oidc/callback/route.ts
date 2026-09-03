import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCommunity } from "@/lib/community";
import { findOrCreateMemberByOidcSubject } from "@/lib/member";
import { handleOidcCallback, OIDC_FLOW_COOKIE } from "@/lib/oidc";
import { createSession } from "@/lib/session";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request);
  const jar = await cookies();
  // The flow cookie is genuinely one-time — cleared here regardless of
  // how this request turns out, same "single-use" posture a magic-link
  // token's own consumedAt already enforces.
  const raw = jar.get(OIDC_FLOW_COOKIE)?.value;
  jar.delete(OIDC_FLOW_COOKIE);

  if (!raw) {
    return NextResponse.redirect(new URL("/login?error=oidc_state_missing", appUrl));
  }

  let flow: { state: string; nonce: string; codeVerifier: string };
  try {
    flow = JSON.parse(raw);
  } catch {
    return NextResponse.redirect(new URL("/login?error=oidc_state_missing", appUrl));
  }

  const community = await getOrCreateCommunity();

  let result;
  try {
    result = await handleOidcCallback(community, new URL(request.url), {
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.codeVerifier,
    });
  } catch (err) {
    console.error("[auth/oidc/callback] OIDC login failed:", err);
    return NextResponse.redirect(new URL("/login?error=oidc_error", appUrl));
  }

  // "No qualifying role → a real, visible 'not authorized for
  // Orchard' page, never a silent account creation" — see
  // docs/development-plan.md's Phase 57. Checked before any
  // Member/MemberIdentity row is ever touched.
  if (!result.hasRequiredRole) {
    return NextResponse.redirect(new URL("/login?error=oidc_not_authorized", appUrl));
  }

  const memberRow = await findOrCreateMemberByOidcSubject(community, {
    sub: result.sub,
    email: result.email,
    name: result.name,
  });
  await createSession(memberRow.id);

  return NextResponse.redirect(new URL("/dashboard", appUrl));
}
