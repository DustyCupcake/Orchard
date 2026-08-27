import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Falls back to a placeholder at build time: Next.js imports this module
// while statically collecting route/page data, before real env vars exist.
// postgres.js connects lazily, so this only matters if a query actually
// runs against the placeholder, which shouldn't happen outside a build.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://placeholder:placeholder@localhost:5432/placeholder";

// onnotice: silence Postgres NOTICE messages (e.g. from TRUNCATE ...
// CASCADE in tests) — noise, not something the app needs to act on.
const client = postgres(connectionString, { onnotice: () => {} });

export const db = drizzle(client, { schema });
