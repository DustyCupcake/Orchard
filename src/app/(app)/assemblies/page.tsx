import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listAssemblies } from "@/lib/assemblies";
import { BUTTON_PRIMARY, CARD, Tag, type Tone } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building",
  notice: "Notice — voting not open yet",
  voting: "Voting open",
  closed: "Closed",
};

const PHASE_TONE: Record<string, Tone> = {
  agenda: "neutral",
  notice: "neutral",
  voting: "warning",
  closed: "neutral",
};

// Community-wide decisions, not task-execution questions — see
// docs/spec.md's "Assemblies". No built-in urgent notification: this
// page (and each Assembly's own link) is the whole delivery mechanism.
export default async function AssembliesPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const assemblies = await listAssemblies(viewing);

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Assemblies</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Community-wide decisions — anything from a genuinely urgent one-off to a slower,
        deliberate structural question. Any member can propose one; results are always advisory,
        never applied automatically.
      </p>
      <div className="mt-4">
        <Link href="/assemblies/new" className={BUTTON_PRIMARY}>
          Propose an Assembly
        </Link>
      </div>

      {assemblies.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-muted)]">None yet.</p>}
      <div className="mt-6 flex flex-col gap-2">
        {assemblies.map((a) => (
          <div key={a.id} className={CARD}>
            <div className="flex items-center gap-2">
              <Link href={`/assemblies/${a.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                {a.title}
              </Link>
              <Tag tone={PHASE_TONE[a.phase]}>{PHASE_LABEL[a.phase] ?? a.phase}</Tag>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
