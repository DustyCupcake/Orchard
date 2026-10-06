import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Testing a migration against data that already exists.
//
// The suite migrates an empty database once and truncates between tests, so
// it exercises every migration on *no rows*. That is exactly the case in
// which a migration that breaks on real data looks fine: 0083 added a
// NOT NULL column with no default and backfilled it afterwards, which
// Postgres rejects the moment a single row exists, and which crash-looped
// the container on deploy while every test passed.
//
// So a test that matters here builds the database the way a real one got
// there: migrate up to just before the migration under test, insert rows in
// the *old* shape with plain SQL (the ORM's current schema no longer
// describes them), run the migration, and look at what it did to them.
//
// Each scenario gets its own throwaway database on the same Postgres server
// the suite already uses, so nothing here touches the shared test database
// and nothing depends on another scenario having run.

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type JournalEntry = { idx: number; tag: string; [key: string]: unknown };
type Journal = { entries: JournalEntry[]; [key: string]: unknown };

function readJournal(): Journal {
  return JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
}

export type ScratchDatabase = {
  url: string;
  sql: ReturnType<typeof postgres>;
  /** Runs every migration up to and including `tag`. */
  migrateTo(tag: string): Promise<void>;
  /** Runs every migration up to, but not including, `tag`. */
  migrateBefore(tag: string): Promise<void>;
  /** Runs whatever is left. */
  migrateRemaining(): Promise<void>;
  drop(): Promise<void>;
};

export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");

  const name = `migration_test_${randomBytes(5).toString("hex")}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${name}`;
  const scratchUrl = url.toString();
  const sql = postgres(scratchUrl, { max: 1, onnotice: () => {} });

  const tmpDirs: string[] = [];

  // drizzle's migrator reads a folder: meta/_journal.json plus the .sql file
  // each entry names, and applies whatever the database hasn't yet. A
  // truncated copy of the journal is therefore a migrator that stops early,
  // and a later run against the full folder carries on from there.
  async function migrateEntries(count: number) {
    const journal = readJournal();
    const entries = journal.entries.slice(0, count);
    const dir = mkdtempSync(path.join(tmpdir(), "orchard-migrate-"));
    tmpDirs.push(dir);
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
    }
    await migrate(drizzle(sql), { migrationsFolder: dir });
  }

  function indexOf(tag: string) {
    const i = readJournal().entries.findIndex((e) => e.tag === tag);
    if (i === -1) throw new Error(`No migration called ${tag}`);
    return i;
  }

  return {
    url: scratchUrl,
    sql,
    migrateTo: (tag) => migrateEntries(indexOf(tag) + 1),
    migrateBefore: (tag) => migrateEntries(indexOf(tag)),
    migrateRemaining: () => migrateEntries(readJournal().entries.length),
    drop: async () => {
      await sql.end();
      const dropper = postgres(base, { max: 1, onnotice: () => {} });
      await dropper.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await dropper.end();
      for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}
