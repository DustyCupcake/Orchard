import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Static checks on the migration files themselves. No database.
//
// Both exist because the failure they guard against is invisible to the rest
// of the suite, which only ever migrates an empty database and so cannot see
// what a migration does to rows that already exist.

const DRIZZLE_DIR = path.join(process.cwd(), "drizzle");
const sqlFiles = readdirSync(DRIZZLE_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("migration files", () => {
  it("finds the migrations (so the checks below can't silently scan nothing)", () => {
    expect(sqlFiles.length).toBeGreaterThan(80);
  });

  // scripts/check-migrations.mjs existed but was wired in nowhere, so the
  // thing it guards against — a journal entry dropped or duplicated by
  // drizzle-kit, leaving a .sql file that is silently never run, which
  // "Migrations complete." then reports as success — could only be caught by
  // somebody remembering to run it. It matters most when two sessions are
  // generating migrations against the same chain.
  it("the journal and the .sql files on disk agree", () => {
    expect(() => execFileSync("node", ["scripts/check-migrations.mjs"], { stdio: "pipe" })).not.toThrow();
  });

  // The 0083 failure, as a rule: a NOT NULL column added with no DEFAULT
  // cannot be added to a table that has any rows, because Postgres checks the
  // constraint when the column appears, before any backfill can run. It
  // passes on an empty table, which is where every test runs, and crash-loops
  // the container on a populated one. drizzle-kit emits exactly this whenever
  // a column is declared notNull() with no default.
  //
  // The fix is the three-step form (add nullable, backfill, SET NOT NULL), or
  // a DEFAULT. A table created in the same migration is safe, because it
  // has no rows — say so with a marker on the line above:
  //
  //   -- migration-lint: allow-not-null-no-default <why this table is empty>
  it("never adds a NOT NULL column without a default to a table that may have rows", () => {
    const offenders: string[] = [];
    for (const file of sqlFiles) {
      const lines = readFileSync(path.join(DRIZZLE_DIR, file), "utf8").split("\n");
      // Statements can span lines, so join each one up to its terminator.
      let buffer = "";
      let startLine = 0;
      lines.forEach((line, i) => {
        if (buffer === "") startLine = i;
        buffer += `${line}\n`;
        if (!line.includes(";")) return;
        const statement = buffer;
        buffer = "";
        if (!/ALTER TABLE\s+"?\w+"?\s+ADD COLUMN/i.test(statement)) return;
        if (!/\bNOT NULL\b/i.test(statement) || /\bDEFAULT\b/i.test(statement)) return;
        const above = lines.slice(Math.max(0, startLine - 3), startLine + 1).join("\n");
        if (/migration-lint:\s*allow-not-null-no-default/i.test(above)) return;
        offenders.push(`${file}:${startLine + 1}  ${statement.trim().replace(/\s+/g, " ").slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the rule above actually catches the shape it exists for", () => {
    // A guard that matches nothing passes forever. This is the original 0083
    // statement, run through the same matcher.
    const statement = 'ALTER TABLE "objection" ADD COLUMN "community_id" uuid NOT NULL;';
    expect(/ALTER TABLE\s+"?\w+"?\s+ADD COLUMN/i.test(statement)).toBe(true);
    expect(/\bNOT NULL\b/i.test(statement) && !/\bDEFAULT\b/i.test(statement)).toBe(true);
  });
});
