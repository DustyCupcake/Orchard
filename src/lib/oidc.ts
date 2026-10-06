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
  /**
   * The standard `email_verified` claim, or null when the IdP doesn't send
   * one.
   *
   * Kept as three states on purpose rather than a boolean: plenty of IdPs
   * return an `email` claim with no verification status at all, and
   * collapsing "said no" into "said nothing" would make an unverified claim
   * indistinguishable from a confirmed one. Callers use it to decide
   * whether the address they provision is a proven one.
   */
  emailVerified: boolean | null;
  /**
   * `nickname` and `given_name`, or null when the IdP sends neither.
   *
   * Two claims rather than one pre-resolved `name`, and specifically not
   * the standard `name` claim: a roster entry is a name somebody chose to
   * be called, and a full name ("Toby Whitfield") is the least useful
   * thing an IdP can offer for that. The IdP's `nickname` is the claim
   * that actually means it, and `given_name` is the honest fallback for
   * the very common profile where someone set a first name and no
   * nickname. `name` is never read.
   *
   * Resolved to a single value by the caller (src/lib/member.ts), since
   * "what do we call this person, in order" is a question about a Member,
   * not about what an IdP said — and the same chain is worth applying to
   * the invite and application paths, which have none of these claims.
   */
  nickname: string | null;
  givenName: string | null;
  hasRequiredRole: boolean;
}

export interface OidcCallbackChecks {
  expectedState: string;
  expectedNonce: string;
  pkceCodeVerifier: string;
}

/**
 * A profile claim that is present, a string, and not blank.
 *
 * The blank check is the whole reason this exists rather than an inline
 * `typeof x === "string" ? x : null`. Zitadel returns `nickname: ""` for
 * every profile where the person never set one, rather than omitting the
 * claim — so a plain string check hands the member's own name-resolution
 * chain an empty string, `nickname?.trim() || ...` falls through it by
 * luck, and any future reader who doesn't remember that gets a member
 * whose name is the empty string. "The IdP said something empty" and "the
 * IdP said nothing" are the same fact here, and both are null.
 */
function optionalClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
    // Absent claim → null, not false. An IdP that has no opinion about
    // verification is not the same as one asserting the address is
    // unverified, and only the first of those is safe to provision a
    // primary from.
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
    nickname: optionalClaim(claims.nickname),
    givenName: optionalClaim(claims.given_name),
    hasRequiredRole: hasRequiredRole(claims as Record<string, unknown>, community.oidcRequiredRole),
  };
}
