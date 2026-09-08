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

  // openid-client derives the redirect_uri it sends to the token endpoint
  // straight from this URL's origin+path (query stripped) — it has to be
  // byte-for-byte the same redirect_uri the login route sent to the IdP.
  // request.url is the raw URL as Next.js sees it, which behind Caddy is
  // plain http on an internal port; building off appUrl (the same
  // resolveAppUrl used for that original redirect_uri) instead of
  // request.url is what keeps the two in sync.
  const currentUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, appUrl);

  let result;
  try {
    result = await handleOidcCallback(community, currentUrl, {
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      pkceCodeVerifier: flow.codeVerifier,
    });
  } catch (err) {
    // openid-client's own error classes (e.g. a token endpoint's error
    // response body) carry the real `error`/`error_description` as
    // plain enumerable properties that a bare `console.error(err)`
    // doesn't surface — log those explicitly so a real IdP's rejection
    // reason is visible in server logs instead of just a generic
    // "server responded with an error" stack.
    console.error(
      "[auth/oidc/callback] OIDC login failed:",
      err instanceof Error ? Object.assign({ message: err.message, cause: err.cause }, err) : err,
    );
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
