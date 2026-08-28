import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { SENSITIVE_FIELD_LABELS, getSensitiveDataTable } from "@/lib/sensitive-data";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

// "For each field the current viewer is unlocked for, a table of
// every member's value" — see docs/spec.md's Sensitive data and
// docs/development-plan.md's Phase 22. The same "surface exactly
// what's relevant to what you hold, in one place" pattern
// /coordination and /escalation already use.
export default async function SensitiveDataPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "sensitive_data");
  const { fields, rows } = moduleOn
    ? await getSensitiveDataTable(currentMember)
    : { fields: [], rows: [] };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <Nav memberName={currentMember.name} />
      <h1>Sensitive data</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && fields.length === 0 && (
        <p style={{ color: "#666" }}>
          Nothing unlocked for you — you&rsquo;ll see fields here once you hold a task or tier
          your Community has set to unlock one. Your own values are always editable from your{" "}
          <code>/profile</code>.
        </p>
      )}

      {moduleOn && fields.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}>
                  Member
                </th>
                {fields.map((f) => (
                  <th
                    key={f}
                    style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.4rem" }}
                  >
                    {SENSITIVE_FIELD_LABELS[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "0.4rem", borderBottom: "1px solid #eee" }}>{r.name}</td>
                  {fields.map((f) => (
                    <td key={f} style={{ padding: "0.4rem", borderBottom: "1px solid #eee" }}>
                      {r.values[f] || <span style={{ color: "#999" }}>—</span>}
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
