import * as client from "openid-client";
import type { community as communityTable } from "@/db/schema";
import { AppError } from "./errors";

type Community = typeof communityTable.$inferSelect;

// One short-lived cookie carrying the state/nonce/PKCE verifier across
// the redirect round-trip to the IdP and back — see the login route's
// own comment for why this is a cookie, not a staging table.
export const OIDC_FLOW_COOKIE = "oidc_flow";
export const OIDC_FLOW_TTL_SECONDS = 10 * 60; // long enough for a real IdP login screen

// See docs/spec.md's "Authentication" — Zitadel is the confirmed second
// provider, alongside (never replacing) magic-link. A Community with
// no OIDC configured just doesn't show the second login option; the
// client secret itself lives in env (OIDC_CLIENT_SECRET), never this
// row, since it's a real credential rather than configuration.
export function isOidcConfigured(community: Community): boolean {
  return Boolean(community.oidcIssuerUrl && community.oidcClientId && community.oidcRequiredRole);
}

// A Configuration is re-discovered (a real network round-trip to
// .well-known/openid-configuration + the issuer's JWKS) on every login
// and every callback rather than cached across requests — logins are
// infrequent enough for this app's scale that the simplicity is worth
// it, the same "cheap enough, not worth the complexity" call this
// codebase makes for other low-volume live lookups. If a future
// deployment's IdP round-trip ever becomes a real latency problem,
// cache the Configuration per (issuerUrl, clientId) with a short TTL
// rather than rearchitecting this.
async function getOidcConfiguration(community: Community): Promise<client.Configuration> {
  if (!community.oidcIssuerUrl || !community.oidcClientId) {
    throw new AppError("OIDC is not configured for this Community");
  }

  const clientSecret = process.env.OIDC_CLIENT_SECRET || undefined;
  // Real deployments must use https; a plain-http issuer (a local test
  // IdP, e.g. this phase's own mock provider in tests/oidc.test.ts) is
  // only ever allowed insecure requests when it's actually configured
  // as http — never a blanket dev-mode bypass.
  const insecure = !community.oidcIssuerUrl.startsWith("https://");

  return client.discovery(
    new URL(community.oidcIssuerUrl),
    community.oidcClientId,
    clientSecret,
    clientSecret ? undefined : client.None(),
    insecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
}

export interface OidcAuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildOidcAuthorizationUrl(
  community: Community,
  redirectUri: string,
): Promise<OidcAuthorizationRequest> {
  const config = await getOidcConfiguration(community);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return { url, state, nonce, codeVerifier };
}

// Zitadel's own project-role claim — see docs/spec.md's Authentication
// ("a role scoped to Orchard's own project in Zitadel"). Resolved
// interpretation, since spec names no exact claim shape and this phase
// has no live Zitadel tenant to confirm against: Zitadel documents this
// claim as an object keyed by role name, each value itself a map of
// org-id -> org-name the role applies within (real deployments must
// also request Zitadel's reserved
// "urn:zitadel:iam:org:project:id:<id>:aud" scope, or use its default
// project, for the claim to be included at all — see Zitadel's own
// OIDC docs). Presence of the configured role name as a top-level key,
// regardless of which org(s) granted it, is read as "carries that
// role." A future session wiring this against a real Zitadel tenant
// should confirm this shape holds and adjust if it differs.
const ZITADEL_ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

export function hasRequiredRole(
  claims: Record<string, unknown>,
  requiredRole: string | null,
): boolean {
  if (!requiredRole) return false;
  const roles = claims[ZITADEL_ROLES_CLAIM];
  if (!roles || typeof roles !== "object") return false;
  return Object.prototype.hasOwnProperty.call(roles, requiredRole);
}

export interface OidcLoginResult {
  sub: string;
  email: string;
  name: string | null;
  hasRequiredRole: boolean;
}

export interface OidcCallbackChecks {
  expectedState: string;
  expectedNonce: string;
  pkceCodeVerifier: string;
}

export async function handleOidcCallback(
  community: Community,
  currentUrl: URL,
  checks: OidcCallbackChecks,
): Promise<OidcLoginResult> {
  const config = await getOidcConfiguration(community);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, checks);
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== "string") {
    throw new AppError("OIDC login did not return a valid identity");
  }
  if (typeof claims.email !== "string") {
    throw new AppError("OIDC login did not return an email address");
  }

  return {
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : null,
    hasRequiredRole: hasRequiredRole(claims as Record<string, unknown>, community.oidcRequiredRole),
  };
}
