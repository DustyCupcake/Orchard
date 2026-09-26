import { getOrCreateCommunity } from "@/lib/community";
import {
  getCycleJoiningState,
  getRecruitmentApplicationFormPublic,
  getRecruitmentApplicationFormPublicById,
} from "@/lib/recruitment";
import { NotFoundError } from "@/lib/errors";
import type { FormField } from "@/lib/forms";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
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
// ?cycle=<id> targets a cycle's own joining config (docs/cycle-scope-
// remediation-plan.md §4.3/8c): that cycle's form (falling back to the
// community's), its door state, and the cycleId tagging on submission.
export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string; invite?: string; cycle?: string }>;
}) {
  const { error, submitted, invite, cycle: cycleParam } = await searchParams;

  const community = await getOrCreateCommunity();
  const cycleId = cycleParam?.trim() || null;

  // Resolve the door + form for the targeted surface. A foreign or
  // nonexistent cycle id renders the "cycle not found" notice below
  // rather than erroring the page.
  let cycleContext: Awaited<ReturnType<typeof getCycleJoiningState>> | null = null;
  let cycleMissing = false;
  if (cycleId) {
    try {
      cycleContext = await getCycleJoiningState(community.id, cycleId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        cycleMissing = true;
      } else {
        throw err;
      }
    }
  }

  const form = cycleMissing
    ? null
    : cycleContext?.cycle.recruitmentApplicationFormId
      ? await getRecruitmentApplicationFormPublicById(community.id, cycleContext.cycle.recruitmentApplicationFormId)
      : await getRecruitmentApplicationFormPublic(community.id);

  const fields = (form?.fields as FormField[] | undefined) ?? [];
  const heading = cycleContext ? `Apply to join ${cycleContext.cycle.name}` : "Apply to join";

  // §4.3/8c door state for a cycle-targeted landing: period + the
  // cycle's own applicationsOpen flag + capacity room. Shut or
  // unconfigured → "not accepting" copy instead of the form.
  const cycleDoorShut =
    cycleContext !== null && !(cycleContext.periodOpen && cycleContext.cycle.applicationsOpen && !cycleContext.atCapacity);
  const notAccepting = !form || cycleDoorShut;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{heading}</h1>

      {cycleMissing ? (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          That event doesn&apos;t exist — check the link.
        </p>
      ) : notAccepting ? (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          {cycleContext
            ? cycleContext.atCapacity
              ? "This event is at capacity — applications for it are closed."
              : cycleContext.periodOpen
                ? "Applications for this event are closed."
                : "Applications for this event aren't open yet."
            : "Not accepting applications right now."}
        </p>
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
            {cycleContext && <input type="hidden" name="cycleId" value={cycleContext.cycle.id} />}
            {fields.map((f) => (
              <FieldPreview
                key={f.key}
                field={toPreviewShape({ ...f, label: f.label, required: f.required ?? false })}
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
