import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Falls back to a placeholder at build time: Next.js imports this module
// while statically collecting route/page data, before real env vars exist.
// postgres.js connects lazily, so this only matters if a query actually
// runs against the placeholder, which shouldn't happen outside a build.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://placeholder:placeholder@localhost:5432/placeholder";

// Cached on globalThis in development, because `next dev` re-evaluates
// server modules on every recompile. A client created at module scope is
// therefore created *again* each time, and the previous one is never
// closed — postgres.js defaults to `max: 10` connections per client with
// `idle_timeout: null`, so they never reap themselves either. A handful of
// edits was enough to strand 35 idle connections and exhaust the dev
// database's `max_connections` (50, see docker-compose.yml), after which
// pages failed with `sorry, too many clients already` — a page-level
// symptom with nothing to do with the page.
//
// Production evaluates this module once, so it gets exactly one pool and
// this is a no-op there. The cast is because `globalThis` is shared with
// unrelated hot-reload state; the key is namespaced to this app.
const globalForDb = globalThis as unknown as {
  __orchardSql?: ReturnType<typeof postgres>;
};

// onnotice: silence Postgres NOTICE messages (e.g. from TRUNCATE ...
// CASCADE in tests) — noise, not something the app needs to act on.
const client =
  globalForDb.__orchardSql ??
  postgres(connectionString, { onnotice: () => {} });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__orchardSql = client;
}

export const db = drizzle(client, { schema });

// A transaction handle — same shape as `db` for query-building purposes.
// Shared so functions can accept either and compose inside one
// transaction (e.g. a lifecycle transition checking Requirements without
// opening a second connection).
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | Tx;
