import { describe, expect, it } from "vitest";
import { readNextParam, safeReturnPath, withNextParam } from "@/lib/login-destination";

// The destination a login returns the visitor to is in URLs and a cookie
// that both the visitor's browser and anyone who can type a URL can
// influence, so every read goes through safeReturnPath and every crafted
// value is tested here rather than trusted from a login page.
describe("safeReturnPath", () => {
  it("accepts app paths, with or without a search string", () => {
    expect(safeReturnPath("/tasks/123")).toBe("/tasks/123");
    expect(safeReturnPath("/tasks/123?a=1&b=2")).toBe("/tasks/123?a=1&b=2");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(safeReturnPath("  /tasks/123  ")).toBe("/tasks/123");
  });

  it("rejects anything that isn't a same-origin app path", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath("tasks/123")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("mailto:x@example.com")).toBeNull();
  });

  it("rejects backslashes and control characters, which locations normalise or reject", () => {
    // Browsers treat "/\evil.com" as a location on the app's own origin,
    // so a single backslash anywhere disqualifies the value.
    expect(safeReturnPath("/\\evil.com")).toBeNull();
    expect(safeReturnPath("/a\\b")).toBeNull();
    expect(safeReturnPath("/tasks\n123")).toBeNull();
    expect(safeReturnPath("/my page")).toBeNull();
    expect(safeReturnPath("/tasks/123\u0000")).toBeNull();
  });

  it("rejects the login page itself, and anything under it — it is a dead end after a login", () => {
    expect(safeReturnPath("/login")).toBeNull();
    expect(safeReturnPath("/login?error=oidc_held")).toBeNull();
    expect(safeReturnPath("/login/")).toBeNull();
  });
});

describe("withNextParam and readNextParam", () => {
  it("round-trips a path with its own nested search string", () => {
    const built = withNextParam("/api/auth/oidc/login", "/tasks/123?a=1");
    expect(readNextParam(new URL(built, "http://orchard.local").searchParams)).toBe("/tasks/123?a=1");
  });

  it("keeps the destination's query and the login URL's own params apart", () => {
    const built = withNextParam("/login?error=oidc_held", "/tasks/123");
    const parsed = new URL(built, "http://orchard.local");
    expect(parsed.searchParams.get("error")).toBe("oidc_held");
    expect(readNextParam(parsed.searchParams)).toBe("/tasks/123");
  });

  it("returns the path unchanged when there is nothing to carry", () => {
    expect(withNextParam("/api/auth/oidc/login", null)).toBe("/api/auth/oidc/login");
    expect(withNextParam("/login?error=x", undefined)).toBe("/login?error=x");
  });

  it("re-validates on read, so a hand-built URL can't get its way through", () => {
    const parsed = new URL("/login?next=https%3A%2F%2Fevil.com", "http://orchard.local");
    expect(readNextParam(parsed.searchParams)).toBeNull();
  });
});
