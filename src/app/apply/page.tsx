import { getOrCreateCommunity } from "@/lib/community";
import { getRecruitmentApplicationFormPublic } from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import { submitApplicationAction } from "./actions";

export const dynamic = "force-dynamic";

// Public, no login required — "the actual evaluated-admission funnel"
// (docs/spec.md's Recruitment). Renders whatever Form the Community
// has configured as its application, the same field-rendering shape
// /feedback already uses for the authenticated post-cycle survey.
// ?invite=<token> optionally carries an invite link's token through to
// the submission — see src/db/schema/recruitment.ts's
// recruitmentApplicationInvite comment for what that unlocks.
export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string; invite?: string }>;
}) {
  const { error, submitted, invite } = await searchParams;

  const community = await getOrCreateCommunity();
  const form = await getRecruitmentApplicationFormPublic(community.id);
  const fields = (form?.fields as FormField[] | undefined) ?? [];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Apply to join</h1>

      {!form ? (
        <p style={{ color: "#666" }}>Not accepting applications right now.</p>
      ) : submitted ? (
        <p style={{ color: "#2a7a2a" }}>Thanks — your application was submitted.</p>
      ) : (
        <>
          {form.description && <p style={{ color: "#666" }}>{form.description}</p>}
          {error && <p style={{ color: "crimson" }}>{error}</p>}

          <form
            action={submitApplicationAction}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {invite && <input type="hidden" name="inviteToken" value={invite} />}
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.required ? " *" : ""}
                <br />
                {f.responseType === "free_text" && (
                  <textarea
                    name={`field_${f.key}`}
                    required={f.required}
                    rows={3}
                    style={{ padding: "0.5rem", width: "100%" }}
                  />
                )}
                {f.responseType === "single_choice" && (
                  <div>
                    {(f.options ?? []).map((o) => (
                      <label key={o} style={{ display: "block", fontWeight: 400 }}>
                        <input type="radio" name={`field_${f.key}`} value={o} required={f.required} /> {o}
                      </label>
                    ))}
                  </div>
                )}
                {f.responseType === "multi_choice" && (
                  <div>
                    {(f.options ?? []).map((o) => (
                      <label key={o} style={{ display: "block", fontWeight: 400 }}>
                        <input type="checkbox" name={`field_${f.key}`} value={o} /> {o}
                      </label>
                    ))}
                  </div>
                )}
              </label>
            ))}

            <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
              Submit application
            </button>
          </form>
        </>
      )}
    </main>
  );
}
