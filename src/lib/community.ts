import { db } from "@/db";
import { community } from "@/db/schema";

// Single-tenant deployment (see docs/architecture.md) — exactly one
// Community per install. There's no setup UI yet (that's Phase 9), so
// the first request that needs a Community just creates the row.
export async function getOrCreateCommunity() {
  const [existing] = await db.select().from(community).limit(1);
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(community)
    .values({ name: process.env.COMMUNITY_NAME || "My Community" })
    .returning();
  return created;
}
