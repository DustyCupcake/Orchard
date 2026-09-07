import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { SENSITIVE_FIELD_LABELS, getSensitiveDataTable } from "@/lib/sensitive-data";

export const dynamic = "force-dynamic";

const TH = "border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
const TD = "border-b border-[var(--border)] px-2 py-2 text-[var(--text)]";

// "For each field the current viewer is unlocked for, a table of
// every member's value" — see docs/spec.md's Sensitive data and
// docs/development-plan.md's Phase 22. The same "surface exactly
// what's relevant to what you hold, in one place" pattern
// /coordination and /escalation already use.
export default async function SensitiveDataPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "sensitive_data");
  const { fields, rows } = moduleOn
    ? await getSensitiveDataTable(viewing)
    : { fields: [], rows: [] };

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Sensitive data</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && fields.length === 0 && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Nothing unlocked for you — you&rsquo;ll see fields here once you hold a task or tier
          your Community has set to unlock one. Your own values are always editable from your{" "}
          <code className="font-mono">/profile</code>.
        </p>
      )}

      {moduleOn && fields.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Member</th>
                {fields.map((f) => (
                  <th key={f} className={TH}>
                    {SENSITIVE_FIELD_LABELS[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className={TD}>{r.name}</td>
                  {fields.map((f) => (
                    <td key={f} className={TD}>
                      {r.values[f] || <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
