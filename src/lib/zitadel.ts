import type { community as communityTable } from "@/db/schema";

type Community = typeof communityTable.$inferSelect;

// docs/plans/admission-flow.md §6a — the calls admission makes to the community's own
// Zitadel so that "admitted" means the person can sign in there too. Every call, body
// and status code below was run against a real tenant (Zitadel v4.13.0) by
// scripts/zitadel-spike.mjs and scripts/zitadel-spike2.mjs, not read from the docs:
//
//   find a person by email   POST /v2/users            queries:[{emailQuery}]  → result[].userId
//   create a person          POST /v2/users/new        no password needed      → { id }
//   invite them              POST /v2/users/{id}/invite_code  { sendCode: {} }  (Zitadel emails it)
//   grant the project role   POST /zitadel.authorization.v2.AuthorizationService/CreateAuthorization
//                            — the REST-style /v2/authorizations paths are 404 on this version;
//                            a second identical grant is HTTP 409 "already exists", which is
//                            success here (the retry case)
//   find their grants        POST /management/v1/users/grants/_search          → result[].{id, projectId, roleKeys}
//   take a grant back        POST …AuthorizationService/DeleteAuthorization    { id }
//
// Orchard never sees or stores a password. The service token is an environment
// credential (ZITADEL_TOKEN), next to OIDC_CLIENT_SECRET, never a database column; the
// project is ZITADEL_PROJECT_ID, and the role is the one the community already says it
// requires (oidcRequiredRole). The host is the OIDC issuer's.

const RPC = "/zitadel.authorization.v2.AuthorizationService";

export type ZitadelConfig = {
  baseUrl: string;
  token: string;
  projectId: string;
  roleKey: string;
  /** From ZITADEL_ORG_ID, or derived from the token on first use. */
  orgId: string | null;
};

/**
 * What it takes to talk to the provider, or null: single sign-on has to be configured,
 * and the token and project have to be in the environment. A community without them
 * simply doesn't get the automation — admission completes and the administrators' to-do
 * says what to do by hand.
 */
export function zitadelConfigFor(community: Community, env: NodeJS.ProcessEnv = process.env): ZitadelConfig | null {
  const token = env.ZITADEL_TOKEN?.trim();
  const projectId = env.ZITADEL_PROJECT_ID?.trim();
  if (!community.oidcIssuerUrl || !community.oidcRequiredRole || !token || !projectId) return null;
  let baseUrl: string;
  try {
    baseUrl = new URL(community.oidcIssuerUrl).origin;
  } catch {
    return null;
  }
  return { baseUrl, token, projectId, roleKey: community.oidcRequiredRole, orgId: env.ZITADEL_ORG_ID?.trim() || null };
}

/** The provider said something a retry won't fix, or couldn't be reached. `retryable` tells the two apart. */
export class ZitadelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ZitadelError";
  }
}

// Never let the token, or a code the provider returned, into a message that gets stored
// or shown: what is kept is the status and the provider's own `message`.
function describeFailure(status: number, text: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    /* not JSON */
  }
  return `HTTP ${status}${message ? ` — ${message}` : ""}`;
}

async function call(config: ZitadelConfig, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}`, Accept: "application/json" };
  if (config.orgId) headers["x-zitadel-orgid"] = config.orgId;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // A network failure or a timeout: worth trying again later.
    throw new ZitadelError(`could not reach the provider (${err instanceof Error ? err.name : "error"})`, true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function orgIdOf(config: ZitadelConfig): Promise<string> {
  if (config.orgId) return config.orgId;
  const r = await call(config, "GET", "/management/v1/orgs/me");
  const id = (r.json as { org?: { id?: string } } | null)?.org?.id;
  if (!r.ok || !id) throw new ZitadelError(`the token was not accepted (${describeFailure(r.status, r.text)})`, r.status >= 500);
  config.orgId = id;
  return id;
}

export async function findUserIdByEmail(config: ZitadelConfig, email: string): Promise<string | null> {
  await orgIdOf(config);
  const r = await call(config, "POST", "/v2/users", {
    queries: [{ emailQuery: { emailAddress: email, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }],
  });
  if (!r.ok) throw new ZitadelError(`could not look the person up (${describeFailure(r.status, r.text)})`, r.status >= 500);
  const result = (r.json as { result?: { userId?: string }[] } | null)?.result ?? [];
  return result[0]?.userId ?? null;
}

export async function createUser(config: ZitadelConfig, input: { email: string; name: string }): Promise<string> {
  const orgId = await orgIdOf(config);
  const parts = input.name.trim().split(/\s+/);
  const r = await call(config, "POST", "/v2/users/new", {
    organizationId: orgId,
    // The address is the username: unique, and what the person already knows.
    username: input.email,
    human: {
      profile: { givenName: parts[0] || input.email, familyName: parts.slice(1).join(" ") || "-", displayName: input.name },
      // Not verified: the invite below is what proves they own it.
      email: { email: input.email, isVerified: false },
    },
  });
  const id = (r.json as { id?: string } | null)?.id;
  if (!r.ok || !id) throw new ZitadelError(`could not create the account (${describeFailure(r.status, r.text)})`, r.status >= 500);
  return id;
}

/** Ask the provider to email the person a link to set up their own sign-in. */
export async function sendInvite(config: ZitadelConfig, userId: string): Promise<void> {
  const r = await call(config, "POST", `/v2/users/${userId}/invite_code`, { sendCode: {} });
  // 409 on a person who has already been invited or has set up their sign-in: nothing to do.
  if (!r.ok && r.status !== 409) {
    throw new ZitadelError(`could not send the invitation (${describeFailure(r.status, r.text)})`, r.status >= 500);
  }
}

/** Give the person the project role. Already having it is success: this is the retry case. */
export async function grantRole(config: ZitadelConfig, userId: string): Promise<void> {
  const orgId = await orgIdOf(config);
  const r = await call(config, "POST", `${RPC}/CreateAuthorization`, {
    userId,
    projectId: config.projectId,
    organizationId: orgId,
    roleKeys: [config.roleKey],
  });
  if (!r.ok && r.status !== 409) {
    throw new ZitadelError(`could not grant the role (${describeFailure(r.status, r.text)})`, r.status >= 500);
  }
}

/**
 * Take back every grant this person holds on Orchard's project, found by asking the
 * provider rather than from an id we kept — a grant someone made by hand is revoked
 * the same as one admission made. Returns how many were removed.
 */
export async function revokeRole(config: ZitadelConfig, userId: string): Promise<number> {
  await orgIdOf(config);
  const found = await call(config, "POST", "/management/v1/users/grants/_search", { queries: [{ userIdQuery: { userId } }] });
  if (!found.ok) throw new ZitadelError(`could not read their grants (${describeFailure(found.status, found.text)})`, found.status >= 500);
  const grants = ((found.json as { result?: { id?: string; projectId?: string }[] } | null)?.result ?? []).filter(
    (g) => g.id && g.projectId === config.projectId,
  );
  let removed = 0;
  for (const g of grants) {
    const r = await call(config, "POST", `${RPC}/DeleteAuthorization`, { id: g.id });
    if (!r.ok && r.status !== 404) throw new ZitadelError(`could not take the role back (${describeFailure(r.status, r.text)})`, r.status >= 500);
    removed++;
  }
  return removed;
}
