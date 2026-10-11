#!/usr/bin/env node
// scripts/zitadel-spike2.mjs — the second probe, for the parts of
// docs/admission-flow.md §6a the first spike (scripts/zitadel-spike.mjs) did
// not cover, run against the real tenant BEFORE the provisioning code is
// written around them:
//   1. Finding a person by email (a user who ALREADY exists must get the role
//      added, not a second account).
//   2. What a second, identical grant does (the retry case): an error, or a
//      quiet no-op, or a second grant?
//   3. Finding a person's existing grants, so "leaving closes the door" can
//      revoke them without having stored an id.
//
// It creates ONE throwaway user at an address on the reserved .invalid domain
// (it can never be real mail, and no invite is sent) and deletes it in a
// `finally`. It never prints the token. Nothing is written to Orchard.
//
//   node --env-file=/path/to/.env.local scripts/zitadel-spike2.mjs

const env = (name) => (process.env[name] ?? "").trim();
const BASE = env("ZITADEL_URL").replace(/\/+$/, "");
const TOKEN = env("ZITADEL_TOKEN");
const PROJECT_ID = env("ZITADEL_PROJECT_ID");
const ROLE_KEY = env("ZITADEL_ROLE_KEY");
let ORG_ID = env("ZITADEL_ORG_ID");
if (!BASE.startsWith("https://") || !TOKEN || !PROJECT_ID || !ROLE_KEY) {
  console.error("Needs ZITADEL_URL (https), ZITADEL_TOKEN, ZITADEL_PROJECT_ID and ZITADEL_ROLE_KEY in the environment.");
  process.exit(2);
}

const mask = (t) => (t ?? "").replaceAll(TOKEN, "«token»").replace(/("(?:code|inviteCode|token|password)"\s*:\s*")[^"]*"/gi, '$1«hidden»"');
const steps = [];
const note = (step, outcome, detail) => {
  steps.push({ step, outcome, detail });
  console.log(`${outcome === "ok" ? "  ok " : " FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };
  if (ORG_ID) headers["x-zitadel-orgid"] = ORG_ID;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, json, text };
}
const show = (r) => mask((r.text || "").slice(0, 400)).replace(/\s+/g, " ");

const me = await call("GET", "/management/v1/orgs/me");
if (!me.ok) {
  console.error(`token not accepted: HTTP ${me.status}`);
  process.exit(1);
}
ORG_ID ||= me.json.org.id;

const stamp = Date.now();
const username = `orchard-spike2-${stamp}`;
const email = `${username}@orchard-spike.invalid`;
let userId = null;
try {
  // Before anything exists: searching for the address finds nobody.
  const emailQuery = (address) => ({
    queries: [{ emailQuery: { emailAddress: address, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }],
  });
  const none = await call("POST", "/v2/users", emailQuery(email));
  note("search by email, nobody there", none.ok && (none.json?.result ?? []).length === 0 ? "ok" : "fail", none.ok ? `${(none.json?.result ?? []).length} found` : `HTTP ${none.status} ${show(none)}`);

  const created = await call("POST", "/v2/users/new", {
    organizationId: ORG_ID,
    username,
    human: { profile: { givenName: "Orchard", familyName: "Spike", displayName: "Orchard spike 2 (delete me)" }, email: { email, isVerified: false } },
  });
  userId = created.json?.id ?? null;
  note("create the throwaway user", userId ? "ok" : "fail", userId ? `id ${userId}` : `HTTP ${created.status} ${show(created)}`);
  if (!userId) throw new Error("cannot continue");

  // 1. Now she exists: the same search finds her, and what shape comes back.
  const found = await call("POST", "/v2/users", emailQuery(email.toUpperCase()));
  const hit = (found.json?.result ?? [])[0];
  note("search by email finds the existing user (case-insensitive)", found.ok && hit?.userId === userId ? "ok" : "fail", found.ok ? `userId ${hit?.userId ?? "(none)"}; keys: ${hit ? Object.keys(hit).join(",") : ""}` : `HTTP ${found.status} ${show(found)}`);

  // 2. Grant twice.
  const body = { userId, projectId: PROJECT_ID, organizationId: ORG_ID, roleKeys: [ROLE_KEY] };
  const rpc = "/zitadel.authorization.v2.AuthorizationService";
  const g1 = await call("POST", `${rpc}/CreateAuthorization`, body);
  note("first grant", g1.ok ? "ok" : "fail", g1.ok ? "created" : `HTTP ${g1.status} ${show(g1)}`);
  const g2 = await call("POST", `${rpc}/CreateAuthorization`, body);
  note("the same grant again (retry case)", "ok", g2.ok ? `accepted, id ${g2.json?.id === g1.json?.id ? "SAME as the first" : "DIFFERENT from the first"}` : `refused: HTTP ${g2.status} ${show(g2)}`);

  // 3. Finding grants for a user, without a stored id.
  const grants = await call("POST", "/management/v1/users/grants/_search", { queries: [{ userIdQuery: { userId } }] });
  const list = grants.json?.result ?? [];
  note("list the user's grants", grants.ok ? "ok" : "fail", grants.ok ? `${list.length} grant(s); ids ${list.map((g) => g.id ?? g.grantId).join(",")}; keys: ${list[0] ? Object.keys(list[0]).join(",") : ""}` : `HTTP ${grants.status} ${show(grants)}`);

  // Revoke every one we can find (what "leaving closes the door" will do).
  for (const g of list) {
    const id = g.id ?? g.grantId;
    const d = await call("POST", `${rpc}/DeleteAuthorization`, { id });
    note(`revoke ${id}`, d.ok ? "ok" : "fail", d.ok ? "" : `HTTP ${d.status} ${show(d)}`);
  }
  const after = await call("POST", "/management/v1/users/grants/_search", { queries: [{ userIdQuery: { userId } }] });
  note("nothing left after revoking", after.ok && (after.json?.result ?? []).length === 0 ? "ok" : "fail", `${(after.json?.result ?? []).length} left`);
} catch (err) {
  note("aborted", "fail", String(err.message ?? err));
} finally {
  if (userId) {
    const del = await call("DELETE", `/v2/users/${userId}`);
    note("delete the throwaway user", del.ok ? "ok" : "fail", del.ok ? "" : `PLEASE DELETE "${username}" (id ${userId}) BY HAND — HTTP ${del.status}`);
  }
}
process.exit(steps.some((s) => s.outcome === "fail") ? 1 : 0);
