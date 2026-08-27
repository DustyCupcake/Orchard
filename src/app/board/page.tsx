import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { listTasksWithAssignments, tierNameLookup } from "@/lib/tasks";
import Nav from "@/components/Nav";
import BranchFilter from "./BranchFilter";
import TaskCard from "./TaskCard";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { status: "unclaimed", label: "Unclaimed" },
  { status: "claimed", label: "Claimed" },
  { status: "waiting", label: "Waiting" },
  { status: "done", label: "Done" },
] as const;

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { branchId, error } = await searchParams;

  const [branches, tasks, tierNames] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, currentMember.communityId)),
    listTasksWithAssignments(currentMember, { branchId }),
    tierNameLookup(currentMember.communityId),
  ]);

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <Nav memberName={currentMember.name} />
      <h1>Board</h1>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {branches.length > 0 && <BranchFilter branches={branches} selectedBranchId={branchId} />}

      {branches.length === 0 && (
        <p style={{ color: "#666" }}>
          No branches yet — this Community&rsquo;s branches (and its first tasks) still need to be
          set up, which isn&rsquo;t built yet (that&rsquo;s Phase 9).
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginTop: "1.5rem",
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => (
          <div key={col.status}>
            <h2 style={{ fontSize: "1rem" }}>
              {col.label} ({tasks.filter((t) => t.status === col.status).length})
            </h2>
            {tasks
              .filter((t) => t.status === col.status)
              .map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  assignments={t.assignments}
                  requirements={t.requirements}
                  unmetRequirements={t.unmetRequirements}
                  tierNames={tierNames}
                  branchName={branchNameById.get(t.branchId) ?? "—"}
                  currentMemberId={currentMember.id}
                />
              ))}
          </div>
        ))}
      </div>
    </main>
  );
}
