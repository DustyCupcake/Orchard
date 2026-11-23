import { cookies, headers } from "next/headers";

// Where an unauthenticated visitor was really trying to go when the (app)
// layout bounced them to the login page: the page they clicked, with its
// query string. It is threaded through the login round trip as the `?next=`
// parameter (the login page, the Zitadel link and the OIDC login route all
// carry it) and through the magic-link round trip as the `orchard_login_dest`
// cookie (the login form's POST sets it, /api/auth/verify consumes it). Both
// providers land the person back on that page once they are signed in — see
// firstLoginDestination in src/lib/first-login.ts for what happens without
// one.
//
// Every value that reaches a redirect target is re-validated by
// safeReturnPath: `next` is in a URL the visitor controls.

export const LOGIN_NEXT_PARAM = "next";
// Set by src/proxy.ts on every page request: the path + query being rendered.
export const REQUEST_PATH_HEADER = "x-orchard-path";
export const LOGIN_DESTINATION_COOKIE = "orchard_login_dest";

// How long a stored destination survives. The bounce, the email round trip
// and a real IdP login screen all fit inside it; a login that never
// completes leaves the cookie to expire, which is the point of having a
// TTL rather than leaving it until some later login happens to read it.
// Same length a magic link gets (LoginForm's copy) — a login attempt that
// dies before completing is at most this stale.
export const LOGIN_DESTINATION_TTL_SECONDS = 15 * 60;

/**
 * Validate a candidate "return to" path.
 *
 * Must be a same-origin app path: it starts with "/" (which also excludes
 * the "javascript:", "https://", "mailto:" and relative-without-slash
 * shapes), is not protocol-relative ("//evil.com"), contains no
 * backslashes (browsers normalise those in a location to forward slashes,
 * so "/\evil.com" would escape the origin), no control characters or
 * spaces, and is not the login page itself — returning to /login after a
 * successful login is a dead end, so it reads as "no destination".
 *
 * Trims surrounding whitespace: a crafted value is at most carrying junk
 * around the real path.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  if (v.includes("\\")) return null;
  if (/[\u0000-\u0020"']/.test(v)) return null;
  if (v === "/login" || v.startsWith("/login?") || v.startsWith("/login/")) return null;
  return v;
}

/**
 * Append the destination to a URL as its `next` parameter, preserving any
 * query the URL already has — the login page builds the bounce URL as
 * "/login?error=…" and the Zitadel link as "/api/auth/oidc/login".
 */
export function withNextParam(path: string, next: string | null | undefined): string {
  if (!next) return path;
  const url = new URL(path, "http://orchard.local");
  url.searchParams.set(LOGIN_NEXT_PARAM, next);
  return `${url.pathname}${url.search}`;
}

/** Read the destination off a URL's query, validated — the login page's entry point. */
export function readNextParam(searchParams: URLSearchParams): string | null {
  return safeReturnPath(searchParams.get(LOGIN_NEXT_PARAM));
}

/**
 * Read the stored destination without consuming it — the login routes'
 * error redirects put it back on the /login URL for the retry.
 */
export async function readLoginDestination(): Promise<string | null> {
  const jar = await cookies();
  return safeReturnPath(jar.get(LOGIN_DESTINATION_COOKIE)?.value);
}

/** Delete the stored destination — the login routes' "we're starting fresh" post. */
export async function clearLoginDestination(): Promise<void> {
  const jar = await cookies();
  jar.delete(LOGIN_DESTINATION_COOKIE);
}

/**
 * Store the destination the visitor was trying to reach, from the login
 * form's POST or the OIDC login route.
 */
export async function storeLoginDestination(path: string): Promise<void> {
  const jar = await cookies();
  jar.set(LOGIN_DESTINATION_COOKIE, path, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOGIN_DESTINATION_TTL_SECONDS,
  });
}

/**
 * Where to send a signed-out visitor: /login, carrying the page they asked
 * for as `?next=`. Used as `redirect(await loginUrl())` by the (app) layout
 * and pages. Falls back to plain /login when the proxy header is missing
 * or fails validation.
 */
export async function loginUrl(): Promise<string> {
  const h = await headers();
  return withNextParam("/login", safeReturnPath(h.get(REQUEST_PATH_HEADER)));
}
