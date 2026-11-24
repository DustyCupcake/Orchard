import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/login-destination";

// Hands the requested path to server components. Layouts and pages can't
// see the request URL in Next.js 16, but an unauthenticated visitor has to
// be sent to /login?next=<page they asked for>, so this copies path + query
// onto a request header that `loginUrl()` reads. It decides nothing about
// who may see what — the layout and pages still check the session against
// the database and do the redirect themselves.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: skip API routes, Next internals and files with an extension.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
