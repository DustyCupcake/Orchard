import { db } from "@/db";
import { healthCheck } from "@/db/schema";
import { desc } from "drizzle-orm";

// DB access must happen per-request, not be baked in at build time.
export const dynamic = "force-dynamic";

async function getStatus() {
  try {
    await db.insert(healthCheck).values({});
    const rows = await db
      .select()
      .from(healthCheck)
      .orderBy(desc(healthCheck.checkedAt))
      .limit(5);
    return { ok: true as const, rows };
  } catch (err) {
    return { ok: false as const, message: (err as Error).message };
  }
}

export default async function Home() {
  const status = await getStatus();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>🌳 Orchard</h1>
      {status.ok ? (
        <>
          <p>Database connection: OK.</p>
          <p>Last {status.rows.length} health checks recorded:</p>
          <ul>
            {status.rows.map((row) => (
              <li key={row.id}>
                {row.id} — {row.checkedAt.toISOString()}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ color: "crimson" }}>
          Database connection failed: {status.message}
        </p>
      )}
    </main>
  );
}
