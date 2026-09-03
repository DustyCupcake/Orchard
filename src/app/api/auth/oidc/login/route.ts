import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCommunity } from "@/lib/community";
import {
  buildOidcAuthorizationUrl,
  isOidcConfigured,
  OIDC_FLOW_COOKIE,
  OIDC_FLOW_TTL_SECONDS,
} from "@/lib/oidc";
import { resolveAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const appUrl = resolveAppUrl(request);
  const community = await getOrCreateCommunity();

  if (!isOidcConfigured(community)) {
    return NextResponse.redirect(new URL("/login?error=oidc_not_configured", appUrl));
  }

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

  return NextResponse.redirect(url);
}
