import type { NextRequest } from "next/server";

// Prefer the explicit APP_URL (set in .env — this is what Caddy actually
// serves publicly). Falls back to the request's own origin, which is
// good enough for local dev but can report the wrong protocol behind a
// reverse proxy that doesn't forward it.
export function resolveAppUrl(request: NextRequest): string {
  return process.env.APP_URL || request.nextUrl.origin;
}
