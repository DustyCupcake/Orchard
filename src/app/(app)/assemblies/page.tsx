import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { listAssemblies } from "@/lib/assemblies";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "agenda building",
  notice: "notice — voting not open yet",
  voting: "voting open",
  closed: "closed",
};

// Community-wide decisions, not task-execution questions — see
// docs/spec.md's "Assemblies". No built-in urgent notification: this
// page (and each Assembly's own link) is the whole delivery mechanism.
export default async function AssembliesPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const assemblies = await listAssemblies(currentMember);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Assemblies</h1>
      <p style={{ color: "#666" }}>
        Community-wide decisions — anything from a genuinely urgent one-off to a slower,
        deliberate structural question. Any member can propose one; results are always advisory,
        never applied automatically.
      </p>
      <p>
        <Link href="/assemblies/new" style={{ color: "inherit" }}>
          Propose an Assembly →
        </Link>
      </p>

      {assemblies.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
      {assemblies.map((a) => (
        <div
          key={a.id}
          style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
        >
          <Link href={`/assemblies/${a.id}`} style={{ color: "inherit", fontWeight: "bold" }}>
            {a.title}
          </Link>{" "}
          <span style={{ fontSize: "0.8rem", color: "#666" }}>· {PHASE_LABEL[a.phase] ?? a.phase}</span>
        </div>
      ))}
    </main>
  );
}
