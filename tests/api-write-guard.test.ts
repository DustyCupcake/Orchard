import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// View-as is documented as strictly read-only, and for REST routes that is
// only true if every mutating handler asks (src/lib/api.ts's
// requireWriteMember, or assertNotViewingAs directly). There are well over
// a hundred of these handlers, written over months by different hands, and
// "remember to call the check" is exactly the rule that decays — so this
// reads the route files and fails on a mutating handler that has neither.
//
// No database: it is a static check of the source tree.

// Routes with no signed-in member to be viewing as anybody: public forms and
// token links used by people who are not members, and the two auth
// endpoints (logging out must keep working, always). Adding a route here is
// a decision to review, which is the point of the list being explicit.
const PUBLIC_OR_AUTH = new Set([
  "src/app/api/apply/route.ts",
  "src/app/api/inquiries/route.ts",
  "src/app/api/auth/logout/route.ts",
  "src/app/api/auth/request/route.ts",
  "src/app/api/invite/[token]/redeem/route.ts",
  "src/app/api/intro-call/[token]/availability/route.ts",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const MUTATING = /^export async function (POST|PUT|PATCH|DELETE)\b/gm;
const ANY_HANDLER = /^export async function (GET|POST|PUT|PATCH|DELETE)\b/gm;

describe("mutating API routes respect View-as", () => {
  const files = routeFiles("src/app/api");

  it("finds the routes (guards against the scan silently matching nothing)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every mutating handler uses requireWriteMember/assertNotViewingAs, or is a listed public route", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.split(path.sep).join("/");
      const source = readFileSync(file, "utf8");
      const starts = [...source.matchAll(ANY_HANDLER)];
      for (const [i, match] of starts.entries()) {
        if (match[1] === "GET") continue;
        const end = starts[i + 1]?.index ?? source.length;
        const body = source.slice(match.index, end);
        const guarded = /\brequireWriteMember\(/.test(body) || /\bassertNotViewingAs\(/.test(body);
        if (!guarded && !PUBLIC_OR_AUTH.has(rel)) offenders.push(`${match[1]} ${rel}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the public allowlist has no stale entries", () => {
    const existing = new Set(files.map((f) => f.split(path.sep).join("/")));
    for (const entry of PUBLIC_OR_AUTH) expect(existing.has(entry)).toBe(true);
  });

  it("no mutating handler still reads identity through the unguarded requireMember()", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const starts = [...source.matchAll(ANY_HANDLER)];
      for (const [i, match] of starts.entries()) {
        if (match[1] === "GET") continue;
        const end = starts[i + 1]?.index ?? source.length;
        const body = source.slice(match.index, end);
        // requireMember() followed by an explicit assertNotViewingAs() is
        // the same guard spelled out (the availability route does this).
        if (/\brequireMember\(/.test(body) && !/\bassertNotViewingAs\(/.test(body)) offenders.push(`${match[1]} ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Keeps the regexes honest: confirms MUTATING itself matches a real handler.
  it("recognises a mutating handler declaration", () => {
    expect("export async function POST(req: Request) {".match(MUTATING)).not.toBeNull();
  });
});
