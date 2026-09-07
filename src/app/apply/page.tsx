import { getOrCreateCommunity } from "@/lib/community";
import { getRecruitmentApplicationFormPublic } from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import FieldPreview from "@/components/FieldPreview";
import { Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
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
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Apply to join</h1>

      {!form ? (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">Not accepting applications right now.</p>
      ) : submitted ? (
        <div className="mt-4">
          <Banner tone="success">Thanks — your application was submitted.</Banner>
        </div>
      ) : (
        <>
          {form.description && <p className="mt-2 text-[13px] text-[var(--text-muted)]">{form.description}</p>}
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <form action={submitApplicationAction} className="mt-6 flex flex-col gap-4">
            {invite && <input type="hidden" name="inviteToken" value={invite} />}
            {fields.map((f) => (
              <FieldPreview
                key={f.key}
                field={{ label: f.label, responseType: f.responseType, options: f.options ?? [], required: f.required ?? false }}
                name={`field_${f.key}`}
              />
            ))}

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Submit application
            </button>
          </form>
        </>
      )}
    </main>
  );
}
