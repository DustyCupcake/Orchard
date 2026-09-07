import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { healthCheck } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getOrCreateCommunity } from "@/lib/community";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";

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

// The actual front door — was a bare Phase 0 DB-connectivity smoke
// test ("a working HTTPS site showing a health-check page reading real
// data from Postgres," docs/development-plan.full-archive.md). Now a
// real branded landing screen (the community's own name/logo, same
// BrandMark data AppShell.tsx's sidebar reads), with that original
// check kept but demoted to a collapsed diagnostic at the bottom
// rather than deleted — still genuinely useful for confirming a fresh
// deploy is actually talking to Postgres.
export default async function Home() {
  const [status, currentMember, community] = await Promise.all([
    getStatus(),
    getCurrentMember(),
    getOrCreateCommunity(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        {community.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a community-supplied external URL, not an optimizable local/remote-pattern asset
          <img src={community.logoUrl} alt={community.name} className="h-16 w-16 rounded-[var(--radius-md)] object-cover" />
        ) : null}
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{community.name}</h1>
        <p className="text-[13px] text-[var(--text-muted)]">Task-based, distributed-effort coordination.</p>
      </div>

      <div className="mt-8 flex items-center gap-3">
        {currentMember ? (
          <>
            <Link href="/dashboard" className={BUTTON_PRIMARY}>
              Continue as {currentMember.name}
            </Link>
            <Link href="/profile" className={BUTTON_SECONDARY}>
              Profile
            </Link>
          </>
        ) : (
          <Link href="/login" className={BUTTON_PRIMARY}>
            Log in
          </Link>
        )}
      </div>

      <details className="mt-16 w-full max-w-sm">
        <summary className="cursor-pointer text-center text-[12px] text-[var(--text-muted)]">System status</summary>
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-[12px]">
          {status.ok ? (
            <>
              <p className="text-[var(--success)]">Database connection: OK.</p>
              <ul className="mt-2 flex flex-col gap-1 text-[var(--text-muted)]">
                {status.rows.map((row) => (
                  <li key={row.id}>
                    {row.id} — {row.checkedAt.toISOString()}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[var(--danger)]">Database connection failed: {status.message}</p>
          )}
        </div>
      </details>
    </main>
  );
}
