#!/usr/bin/env node
// scripts/zitadel-spike.mjs — a throwaway probe of the Zitadel API calls that
// docs/admission-flow.md §6a wants admission to make, run against a real
// tenant BEFORE any of it is built.
//
// What it answers (the docs describe the calls; they do not say which exact
// URL or body shape a given Zitadel version accepts, which manager roles are
// enough, or whether revoking works):
//   1. Which "create user" call and body this version accepts.
//   2. That an invite code can be minted WITHOUT emailing anyone.
//   3. Which "grant a project role" call works (new authorization service, or
//      the deprecated management call), and with which manager roles.
//   4. That the grant can be read back, and revoked (for "leaving closes the
//      door").
//   5. That everything it created is gone afterwards.
//
// It creates ONE user whose name is obviously a test
// (orchard-spike-<timestamp>) and deletes it in a `finally`, whatever
// happens. It never prints the token or the invite code. Nothing is written
// to the Orchard database; it does not import any Orchard code.
//
// ── Setup (once) ────────────────────────────────────────────────────────────
// 1. In the Zitadel console: Users → Service Accounts → New. Any username
//    (e.g. orchard-provisioner). Then open it → Personal Access Tokens → New,
//    and copy the token (it is shown once).
// 2. Make that service account a manager of the organization that holds your
//    users: Organization → Managers (the "+" at the top right) → pick the
//    service account → roles. Start with the NARROW pair
//       Org User Manager  +  Org User Permission Editor
//    (if the script reports a 403/permission error, add "Org Owner" instead,
//    and tell me — that tells us the narrow pair isn't enough).
// 3. Put these in /Users/toby/Local/Orchard/.env.local — a git-ignored file
//    that is NOT read by docker-compose:
//       ZITADEL_URL=https://your-zitadel-host        (no trailing slash)
//       ZITADEL_TOKEN=<the personal access token>
//       ZITADEL_PROJECT_ID=<the Orchard project's id: Projects → Orchard → ID>
//       ZITADEL_ROLE_KEY=<the role key Orchard requires, as set in Settings>
//       ZITADEL_ORG_ID=<optional: derived from the token if left out>
//
// ── Run ─────────────────────────────────────────────────────────────────────
//    node scripts/zitadel-spike.mjs            # read-only preflight, no changes
//    node scripts/zitadel-spike.mjs --run      # creates, grants, revokes, deletes

const RUN = process.argv.includes("--run");

try {
  process.loadEnvFile(".env.local");
} catch {
  // No file is fine if the variables are already in the environment.
}

const env = (name) => (process.env[name] ?? "").trim();
const BASE = env("ZITADEL_URL").replace(/\/+$/, "");
const TOKEN = env("ZITADEL_TOKEN");
const PROJECT_ID = env("ZITADEL_PROJECT_ID");
const ROLE_KEY = env("ZITADEL_ROLE_KEY");
let ORG_ID = env("ZITADEL_ORG_ID");

const missing = ["ZITADEL_URL", "ZITADEL_TOKEN", "ZITADEL_PROJECT_ID", "ZITADEL_ROLE_KEY"].filter((n) => !env(n));
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}\nSee the header of scripts/zitadel-spike.mjs.`);
  process.exit(2);
}
if (!BASE.startsWith("https://")) {
  console.error("ZITADEL_URL must be an https:// URL — the token is sent to it.");
  process.exit(2);
}

const report = { host: new URL(BASE).host, steps: [] };
const note = (step, outcome, detail) => {
  report.steps.push({ step, outcome, detail });
  console.log(`${outcome === "ok" ? "  ok " : outcome === "skip" ? " skip" : " FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};

// Never let a secret reach the log: the token is only ever in the header, and
// codes/tokens in a response body are masked before printing.
const mask = (text) =>
  text
    .replaceAll(TOKEN, "«token»")
    .replace(/("(?:code|inviteCode|emailCode|phoneCode|token|password)"\s*:\s*")[^"]*"/gi, '$1«hidden»"');

async function call(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };
  if (ORG_ID) headers["x-zitadel-orgid"] = ORG_ID;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    return { status: 0, ok: false, json: null, text: String(err.message ?? err) };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON; leave null
  }
  return { status: res.status, ok: res.ok, json, text };
}

const show = (r) => mask((r.text || "").slice(0, 500)).replace(/\s+/g, " ");

// ── Preflight (read-only) ────────────────────────────────────────────────────
console.log(`\nZitadel spike against ${report.host} — ${RUN ? "WRITE MODE (--run)" : "read-only preflight"}\n`);

const me = await call("GET", "/management/v1/orgs/me");
if (me.ok && me.json?.org?.id) {
  ORG_ID ||= me.json.org.id;
  note("token works; organization", "ok", `${me.json.org.name} (${me.json.org.id})`);
} else {
  note("token works; organization", "fail", `HTTP ${me.status} ${show(me)}`);
  console.error("\nThe token was not accepted. Check ZITADEL_URL and the token, then re-run.");
  process.exit(1);
}

const roles = await call("POST", `/management/v1/projects/${PROJECT_ID}/roles/_search`, {});
if (roles.ok) {
  const keys = (roles.json?.result ?? []).map((r) => r.key);
  note(
    "project readable; role exists",
    keys.includes(ROLE_KEY) ? "ok" : "fail",
    keys.includes(ROLE_KEY) ? `role "${ROLE_KEY}" is defined` : `roles defined: ${keys.join(", ") || "(none)"} — ZITADEL_ROLE_KEY is not one of them`,
  );
} else {
  note("project readable; role exists", "fail", `HTTP ${roles.status} ${show(roles)}`);
}

const search = await call("POST", "/v2/users", { query: { limit: 1 } });
note("can search users (user.read)", search.ok ? "ok" : "fail", search.ok ? "" : `HTTP ${search.status} ${show(search)}`);

if (!RUN) {
  console.log("\nPreflight only. Re-run with --run to create, grant, revoke and delete a throwaway user.");
  process.exit(report.steps.some((s) => s.outcome === "fail") ? 1 : 0);
}

// ── Write phase ──────────────────────────────────────────────────────────────
const stamp = Date.now();
const username = `orchard-spike-${stamp}`;
const email = `${username}@orchard-spike.invalid`; // .invalid is reserved: it can never be real mail
let userId = null;
let authId = null;
let grantVia = null;

try {
  // 1. create the user — newer call first, then the older one.
  const attempts = [
    {
      name: "POST /v2/users/new",
      path: "/v2/users/new",
      body: {
        organizationId: ORG_ID,
        username,
        human: {
          profile: { givenName: "Orchard", familyName: "Spike", displayName: "Orchard spike (delete me)" },
          email: { email, isVerified: false },
        },
      },
    },
    {
      name: "POST /v2/users/human",
      path: "/v2/users/human",
      body: {
        organization: { orgId: ORG_ID },
        username,
        profile: { givenName: "Orchard", familyName: "Spike", displayName: "Orchard spike (delete me)" },
        email: { email, isVerified: false },
      },
    },
  ];
  let created = null;
  for (const a of attempts) {
    const r = await call("POST", a.path, a.body);
    const id = r.json?.id ?? r.json?.userId;
    if (r.ok && id) {
      created = { via: a.name, id };
      note(`create user (${a.name})`, "ok", `id ${id}`);
      break;
    }
    note(`create user (${a.name})`, "fail", `HTTP ${r.status} ${show(r)}`);
  }
  if (!created) throw new Error("could not create a user with either call");
  userId = created.id;

  // 2. an invite code, returned to us rather than emailed.
  const inv = await call("POST", `/v2/users/${userId}/invite_code`, { returnCode: {} });
  note("invite code, not emailed (returnCode)", inv.ok ? "ok" : "fail", inv.ok ? "code minted, not printed" : `HTTP ${inv.status} ${show(inv)}`);

  // 3. grant the project role — authorization service first, deprecated call last.
  const grantBody = { userId, projectId: PROJECT_ID, organizationId: ORG_ID, roleKeys: [ROLE_KEY] };
  const grantAttempts = [
    { name: "POST /v2/authorizations", method: "POST", path: "/v2/authorizations", body: grantBody, idOf: (j) => j?.id ?? j?.authorizationId },
    {
      name: "AuthorizationService/CreateAuthorization (RPC path)",
      method: "POST",
      path: "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization",
      body: grantBody,
      idOf: (j) => j?.id ?? j?.authorizationId,
    },
    {
      name: "management POST /users/{id}/grants (deprecated)",
      method: "POST",
      path: `/management/v1/users/${userId}/grants`,
      body: { projectId: PROJECT_ID, roleKeys: [ROLE_KEY] },
      idOf: (j) => j?.userGrantId,
    },
  ];
  for (const a of grantAttempts) {
    const r = await call(a.method, a.path, a.body);
    const id = a.idOf(r.json);
    if (r.ok && id) {
      authId = id;
      grantVia = a.name;
      note(`grant role "${ROLE_KEY}" (${a.name})`, "ok", `id ${id}`);
      break;
    }
    note(`grant role "${ROLE_KEY}" (${a.name})`, "fail", `HTTP ${r.status} ${show(r)}`);
  }
  if (!authId) throw new Error("no grant call worked");

  // 4. read it back.
  const readAttempts = [
    { name: "POST /v2/authorizations/search", path: "/v2/authorizations/search", body: { filters: [{ inUserIds: { ids: [userId] } }] } },
    { name: "management users/grants/_search", path: "/management/v1/users/grants/_search", body: { queries: [{ userIdQuery: { userId } }] } },
  ];
  let readOk = false;
  for (const a of readAttempts) {
    const r = await call("POST", a.path, a.body);
    const text = r.text ?? "";
    if (r.ok && text.includes(ROLE_KEY)) {
      note(`read the grant back (${a.name})`, "ok", `role "${ROLE_KEY}" present`);
      readOk = true;
      break;
    }
    note(`read the grant back (${a.name})`, "fail", `HTTP ${r.status} ${show(r)}`);
  }
  if (!readOk) note("read the grant back", "fail", "no read call returned the role");

  // 5. revoke it (what "leaving closes the door" needs), then confirm.
  const revokeAttempts = grantVia?.startsWith("management")
    ? [{ name: "management DELETE users/{id}/grants/{grantId}", method: "DELETE", path: `/management/v1/users/${userId}/grants/${authId}` }]
    : [
        { name: "DELETE /v2/authorizations/{id}", method: "DELETE", path: `/v2/authorizations/${authId}` },
        {
          name: "AuthorizationService/DeleteAuthorization (RPC path)",
          method: "POST",
          path: "/zitadel.authorization.v2.AuthorizationService/DeleteAuthorization",
          body: { id: authId },
        },
        { name: "management DELETE users/{id}/grants/{grantId}", method: "DELETE", path: `/management/v1/users/${userId}/grants/${authId}` },
      ];
  let revoked = false;
  for (const a of revokeAttempts) {
    const r = await call(a.method, a.path, a.body);
    if (r.ok) {
      note(`revoke the grant (${a.name})`, "ok");
      revoked = true;
      break;
    }
    note(`revoke the grant (${a.name})`, "fail", `HTTP ${r.status} ${show(r)}`);
  }
  if (!revoked) note("revoke the grant", "fail", "no revoke call worked — the grant is removed when the user is deleted below");
} catch (err) {
  note("spike aborted", "fail", String(err.message ?? err));
} finally {
  // 6. always remove what we made.
  if (userId) {
    let gone = false;
    for (const [method, path] of [
      ["DELETE", `/v2/users/${userId}`],
      ["DELETE", `/management/v1/users/${userId}`],
    ]) {
      const r = await call(method, path);
      if (r.ok) {
        gone = true;
        note(`delete the throwaway user (${method} ${path.split("/").slice(0, 3).join("/")}/…)`, "ok");
        break;
      }
    }
    if (!gone) {
      note("delete the throwaway user", "fail", `PLEASE DELETE "${username}" (id ${userId}) BY HAND in the console`);
    }
  }
}

console.log("\n" + JSON.stringify(report, null, 2));
process.exit(report.steps.some((s) => s.outcome === "fail") ? 1 : 0);
