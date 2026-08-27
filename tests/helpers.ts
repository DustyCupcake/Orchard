import { sql } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, member } from "@/db/schema";

// Wipes everything derived from Community — cheap and total, so each
// test file starts from a clean slate. Requires a real, disposable
// Postgres reachable via DATABASE_URL (see package.json's "test" script).
export async function resetDatabase() {
  await db.execute(sql`TRUNCATE TABLE community RESTART IDENTITY CASCADE`);
}

export async function createFixtures() {
  const [testCommunity] = await db
    .insert(community)
    .values({ name: "Test Community" })
    .returning();

  const [testBranch] = await db
    .insert(branch)
    .values({ communityId: testCommunity.id, name: "Fruit" })
    .returning();

  const [alice] = await db
    .insert(member)
    .values({ communityId: testCommunity.id, name: "Alice" })
    .returning();

  const [bob] = await db
    .insert(member)
    .values({ communityId: testCommunity.id, name: "Bob" })
    .returning();

  return { community: testCommunity, branch: testBranch, alice, bob };
}
