import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCommunity } from "@/lib/community";
import {
  buildOidcAuthorizationUrl,
  isOidcConfigured,
  OIDC_FLOW_COOKIE,
  OIDC_FLOW_TTL_SECONDS,
} from "@/lib/oidc";
import { clearLoginDestination, readNextParam, storeLoginDestination } from "@/lib/login-destination";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request);
  const community = await getOrCreateCommunity();

  if (!isOidcConfigured(community)) {
    return NextResponse.redirect(new URL("/login?error=oidc_not_configured", appUrl));
  }

  // The page the visitor was trying to open rides in from the login
  // page as ?next= — stored for /api/auth/oidc/callback to redirect to
  // once the sign-in completes (see src/lib/login-destination.ts).
  const next = readNextParam(request.nextUrl.searchParams);

  const redirectUri = new URL("/api/auth/oidc/callback", appUrl).toString();
  const { url, state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(community, redirectUri);

  const jar = await cookies();
  jar.set(OIDC_FLOW_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_FLOW_TTL_SECONDS,
  });
  if (next) {
    await storeLoginDestination(next);
  } else {
    await clearLoginDestination();
  }

  return NextResponse.redirect(url);
}
