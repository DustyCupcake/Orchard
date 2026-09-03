import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// A minimal, real, spec-compliant local OIDC provider — not a stub of
// this codebase's own oidc.ts, a genuine second HTTP server that
// src/lib/oidc.ts's real discovery/token-exchange/JWT-signature-
// verification code talks to over real network requests. This is the
// closest thing to "real, no mocks" testing achievable for Phase 57
// without live Zitadel credentials (which this environment has none
// of) — every cryptographic step (PKCE, state, nonce, RS256 signature
// verification against a real JWKS) runs for real against this server,
// just not literally Zitadel's own servers.
export interface MockOidcProvider {
  issuerUrl: string;
  clientId: string;
  // Registers what the *next* code redemption should resolve to —
  // call once per simulated login, right before building the fake
  // callback URL, mirroring how a real IdP only knows what to embed in
  // the id_token once the user has actually authenticated on its own
  // authorize screen (which this mock never actually renders — nothing
  // in this phase's flow needs a browser to click through it).
  prepareLogin(claims: { sub: string; email: string; nonce: string; roles?: Record<string, unknown> }): string;
  close(): Promise<void>;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockOidcProvider(): Promise<MockOidcProvider> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "mock-key-1";
  Object.assign(jwk, { kid, alg: "RS256", use: "sig" });

  const clientId = "orchard-test-client";
  let issuerUrl = "";
  // One pending login at a time is all any single test needs — a
  // fresh code per prepareLogin() call, redeemable exactly once,
  // mirroring a real authorization code's single-use guarantee.
  let pending: { code: string; sub: string; email: string; nonce: string; roles?: Record<string, unknown> } | null =
    null;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
          jwks_uri: `${issuerUrl}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }

    if (url.pathname === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const code = params.get("code");

      if (!pending || code !== pending.code) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      // Single-use — the same real guarantee a magic-link token has.
      const { sub, email, nonce, roles } = pending;
      pending = null;

      const idToken = await new SignJWT({
        email,
        name: "Mock Zitadel User",
        nonce,
        ...(roles ? { "urn:zitadel:iam:org:project:roles": roles } : {}),
      })
        .setProtectedHeader({ alg: "RS256", kid })
        .setIssuer(issuerUrl)
        .setAudience(clientId)
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);

      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: `mock-access-${randomUUID()}`,
          token_type: "Bearer",
          id_token: idToken,
          expires_in: 3600,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  issuerUrl = `http://127.0.0.1:${port}`;

  return {
    issuerUrl,
    clientId,
    prepareLogin(claims) {
      const code = `mock-code-${randomUUID()}`;
      pending = { code, ...claims };
      return code;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
