import type { NextRequest } from "next/server";
import { headers } from "next/headers";

// Prefer the explicit APP_URL (set in .env — this is what Caddy actually
// serves publicly). Falls back to the request's own origin, which is
// good enough for local dev but can report the wrong protocol behind a
// reverse proxy that doesn't forward it.
export function resolveAppUrl(request: NextRequest): string {
  return process.env.APP_URL || request.nextUrl.origin;
}

// Same fallback posture as resolveAppUrl, but for a Server Component
// (no NextRequest available there) — used by /invites to render a
// real, absolute, copy-pasteable invite link.
export async function resolveAppUrlFromHeaders(): Promise<string> {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
