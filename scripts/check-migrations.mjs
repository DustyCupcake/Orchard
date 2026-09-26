#!/usr/bin/env node
// Fails if drizzle/meta/_journal.json and the .sql files on disk disagree.
//
// This exists because the disagreement is *silent*. Drizzle's migrator
// reads the journal and applies the entries it finds; a `.sql` file that
// no journal entry names is simply never opened, so `migrate()` reports
// "Migrations complete." on a database that is quietly missing columns.
// The only symptom is a test failing somewhere else entirely.
//
// It happens for a mundane reason: `drizzle-kit generate` derives the
// journal from the snapshot chain, so regenerating from a snapshot taken
// before a later migration existed drops that migration's entry while
// leaving its `.sql` file and snapshot on disk. Two sessions working on
// the same chain is how it surfaced here.
//
//   node scripts/check-migrations.mjs
//
// Exits 0 and prints a summary when consistent; exits 1 and explains
// itself when not. Cheap enough for a pre-commit hook.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const drizzleDir = path.join(root, "drizzle");
const journalPath = path.join(drizzleDir, "meta", "_journal.json");

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const entries = journal.entries ?? [];

const journalTags = new Set(entries.map((e) => e.tag));
const sqlTags = new Set(
  readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -".sql".length)),
);

const unreferenced = [...sqlTags].filter((t) => !journalTags.has(t)).sort();
const missing = [...journalTags].filter((t) => !sqlTags.has(t)).sort();

// A duplicate `idx` is the same class of problem: drizzle orders by it, so
// two entries sharing one makes the order between them undefined.
const byIdx = new Map();
const duplicateIdx = [];
for (const e of entries) {
  if (byIdx.has(e.idx)) duplicateIdx.push(e.idx);
  byIdx.set(e.idx, e.tag);
}

// Gaps matter for the same reason. A journal that skips an index is still
// applied, but it means an entry was removed from the middle rather than
// the tail, which is almost always an accident rather than a rollback.
const indices = entries.map((e) => e.idx).sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < indices.length; i++) {
  if (indices[i] !== indices[i - 1] + 1) gaps.push(`${indices[i - 1]}→${indices[i]}`);
}

const problems = [];
if (unreferenced.length) {
  problems.push(
    `these .sql files exist but no journal entry names them, so migrate() will never run them:\n    ${unreferenced.join("\n    ")}\n  fix: re-add their entries to drizzle/meta/_journal.json (idx, version, when, tag, breakpoints), or delete the files if the migration was abandoned.`,
  );
}
if (missing.length) {
  problems.push(
    `the journal names these, but the .sql files are missing, so migrate() will throw ENOENT:\n    ${missing.join("\n    ")}`,
  );
}
if (duplicateIdx.length) {
  problems.push(
    `duplicate journal idx, which makes ordering between those entries undefined:\n    ${duplicateIdx.join("\n    ")}`,
  );
}
if (gaps.length) {
  problems.push(
    `gaps in the journal idx sequence, so an entry was removed from the middle rather than the tail:\n    ${gaps.join("\n    ")}`,
  );
}

if (problems.length) {
  console.error("drizzle journal and .sql files disagree:\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log(`drizzle journal consistent: ${entries.length} entries, ${sqlTags.size} migrations, last ${entries[entries.length - 1]?.tag ?? "—"}.`);
