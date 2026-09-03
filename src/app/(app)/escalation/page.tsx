import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listEscalatedTasks } from "@/lib/tasks";
import { isCoordinationHolder } from "@/lib/coordination";

export const dynamic = "force-dynamic";

// "Unplaceable tasks surface in a shared 'needs an owner' view visible
// to all coordinators, with cross-branch placement encouraged" — see
// docs/spec.md's Coordination mechanics: Escalation.
export default async function EscalationPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const authorized = await isCoordinationHolder(viewing, null);
  if (!authorized) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
        <h1>Escalation</h1>
        <p style={{ color: "crimson" }}>
          Only a current holder of any branch&rsquo;s coordination-tagged task can see this —
          it&rsquo;s community-wide, not scoped to one branch.
        </p>
      </main>
    );
  }

  const tasks = await listEscalatedTasks(viewing);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Escalation</h1>
      <p style={{ color: "#666" }}>
        Tasks that have escalated — no owner, past the point staleness/deadline tolerates.
        Cross-branch placement is encouraged: taking one of these is always a visible, deliberate
        act.
      </p>

      {tasks.length === 0 && <p style={{ color: "#2a7a2a" }}>Nothing escalated right now.</p>}

      {tasks.length > 0 && (
        <ul>
          {tasks.map((t) => (
            <li key={t.id} style={{ marginBottom: "0.5rem" }}>
              <Link href={`/tasks/${t.id}`} style={{ color: "inherit" }}>
                {t.title}
              </Link>{" "}
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                {t.branchName} · {t.status}
                {t.critical ? " · critical" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
