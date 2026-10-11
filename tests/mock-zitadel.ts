import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for the parts of Zitadel v4.13 that admission calls, shaped exactly as the real
// tenant answered scripts/zitadel-spike.mjs and scripts/zitadel-spike2.mjs: a search that
// returns `result[].userId`, a create that returns `{id}`, a second identical grant that is
// HTTP 409, a grants search whose rows carry `{id, projectId, roleKeys}`, and the REST-style
// authorization paths that do NOT exist on this version (so the code can't quietly depend on them).

export type MockUser = { id: string; email: string; name: string; invited: boolean };
export type MockGrant = { id: string; userId: string; projectId: string; roleKeys: string[] };

export type MockZitadel = {
  url: string;
  users: MockUser[];
  grants: MockGrant[];
  calls: string[];
  /** Make every request fail with this status (null = behave). */
  failWith: number | null;
  /** Refuse only the create call. */
  refuseCreate: boolean;
  seedUser(email: string): MockUser;
  close(): Promise<void>;
};

const body = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

export async function startMockZitadel(): Promise<MockZitadel> {
  let n = 0;
  const state = { users: [] as MockUser[], grants: [] as MockGrant[], calls: [] as string[] };
  const mock = {
    url: "",
    ...state,
    failWith: null as number | null,
    refuseCreate: false,
    seedUser(email: string) {
      const u = { id: `user-${++n}`, email, name: email, invited: false };
      state.users.push(u);
      return u;
    },
  } as unknown as MockZitadel;

  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    state.calls.push(`${req.method} ${path}`);
    const reply = (status: number, json: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (mock.failWith) return reply(mock.failWith, { code: "x", message: "the provider is unhappy" });
    if (req.headers.authorization !== "Bearer test-token") return reply(401, { message: "bad token" });
    const b = await body(req);

    if (req.method === "GET" && path === "/management/v1/orgs/me") return reply(200, { org: { id: "org-1", name: "Test org" } });

    if (req.method === "POST" && path === "/v2/users") {
      const q = (b.queries as { emailQuery?: { emailAddress: string } }[] | undefined)?.[0]?.emailQuery?.emailAddress ?? "";
      const hit = state.users.filter((u) => u.email.toLowerCase() === q.toLowerCase());
      return reply(200, { result: hit.map((u) => ({ userId: u.id, username: u.email })) });
    }

    if (req.method === "POST" && path === "/v2/users/new") {
      if (mock.refuseCreate) return reply(400, { code: "x", message: "invalid account details" });
      const human = b.human as { email: { email: string }; profile: { displayName: string } };
      const u = { id: `user-${++n}`, email: human.email.email, name: human.profile.displayName, invited: false };
      state.users.push(u);
      return reply(200, { id: u.id });
    }

    const invite = path.match(/^\/v2\/users\/([^/]+)\/invite_code$/);
    if (req.method === "POST" && invite) {
      const u = state.users.find((x) => x.id === invite[1]);
      if (!u) return reply(404, { message: "no such user" });
      u.invited = true;
      return reply(200, {});
    }

    if (req.method === "POST" && path === "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization") {
      const userId = b.userId as string;
      const projectId = b.projectId as string;
      if (state.grants.some((g) => g.userId === userId && g.projectId === projectId)) {
        return reply(409, { code: "x", message: "User grant already exists (V3-DKcYh)" });
      }
      const g = { id: `grant-${++n}`, userId, projectId, roleKeys: b.roleKeys as string[] };
      state.grants.push(g);
      return reply(200, { id: g.id });
    }

    if (req.method === "POST" && path === "/management/v1/users/grants/_search") {
      const userId = (b.queries as { userIdQuery?: { userId: string } }[] | undefined)?.[0]?.userIdQuery?.userId;
      return reply(200, { result: state.grants.filter((g) => g.userId === userId) });
    }

    if (req.method === "POST" && path === "/zitadel.authorization.v2.AuthorizationService/DeleteAuthorization") {
      const i = state.grants.findIndex((g) => g.id === b.id);
      if (i < 0) return reply(404, { message: "not found" });
      state.grants.splice(i, 1);
      return reply(200, {});
    }

    // Everything else — including the REST-style /v2/authorizations paths — is a 404, as on the real tenant.
    return reply(404, { message: "Not Found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mock.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return mock;
}
