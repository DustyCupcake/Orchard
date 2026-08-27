// Phase 1 sanity check: create a Community, a Branch, a Member, and a
// Task by hand, and confirm the relationships hold. Not a real seed
// script for actual use — just proof the schema works end to end.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString);
const db = drizzle(client, { schema });

async function main() {
  const [orchardTown] = await db
    .insert(schema.community)
    .values({ name: "Orchard Town" })
    .returning();
  console.log("Created community:", orchardTown.name);

  const [fruit] = await db
    .insert(schema.branch)
    .values({ communityId: orchardTown.id, name: "Fruit", description: "Growing things" })
    .returning();
  console.log("Created branch:", fruit.name);

  const [alice] = await db
    .insert(schema.member)
    .values({ communityId: orchardTown.id, name: "Alice" })
    .returning();
  console.log("Created member:", alice.name);

  const [waterTrees] = await db
    .insert(schema.task)
    .values({
      communityId: orchardTown.id,
      branchId: fruit.id,
      title: "Water the trees",
      description: "Keep the orchard alive",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy: alice.id,
    })
    .returning();
  console.log("Created task:", waterTrees.title);

  // Prove the relationships actually hold by joining back through them.
  const rows = await db
    .select({
      taskTitle: schema.task.title,
      branchName: schema.branch.name,
      communityName: schema.community.name,
      creatorName: schema.member.name,
    })
    .from(schema.task)
    .innerJoin(schema.branch, eq(schema.task.branchId, schema.branch.id))
    .innerJoin(schema.community, eq(schema.task.communityId, schema.community.id))
    .innerJoin(schema.member, eq(schema.task.createdBy, schema.member.id))
    .where(eq(schema.task.id, waterTrees.id));

  console.log("\nJoined back through Task -> Branch -> Community -> Member:");
  console.table(rows);

  await client.end();
}

main().catch((err) => {
  console.error("Seed check failed:", err);
  process.exit(1);
});
