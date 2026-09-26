import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cycle, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getPostCycleFeedbackForm, listPostCycleFeedbackResponses } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import { ForbiddenError } from "@/lib/errors";
import { Banner, BUTTON_PRIMARY, CARD, CheckField, SELECT } from "@/components/ui/kit";
import { submitFeedbackAction } from "./actions";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted } = await searchParams;

  const form = await getPostCycleFeedbackForm(viewing);

  let responses: Awaited<ReturnType<typeof listPostCycleFeedbackResponses>> = [];
  let canReview = false;
  try {
    responses = await listPostCycleFeedbackResponses(viewing);
    canReview = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const memberNameById = canReview
    ? new Map(
        (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
          (m) => [m.id, m.name] as const,
        ),
      )
    : new Map<string, string>();

  // Which cycles a response can be "about" — most recently started
  // first, so the default pick is the freshest one. Untagged responses
  // ("General") stay meaningful for communities that run no cycles.
  const cycles = await db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(eq(cycle.communityId, viewing.communityId))
    .orderBy(desc(cycle.startedAt));
  const cycleNameById = new Map(cycles.map((c) => [c.id, c.name] as const));

  const fields = (form?.fields as FormField[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Feedback</h1>

      {!form && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Not set up for this Community yet — a current Admins holder can define a form and pick
          it as the post-event feedback survey on the Settings screen.
        </p>
      )}

      {form && (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          {submitted && (
            <div className="mt-4">
              <Banner tone="success">Thanks — your response was recorded.</Banner>
            </div>
          )}

          <section className="mt-6">
            <SectionHeading>{form.title}</SectionHeading>
            {form.description && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{form.description}</p>}

            <form action={submitFeedbackAction} className="mt-4 flex flex-col gap-4">
              {cycles.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium text-[var(--text)]">Which event is this about?</span>
                  <span className="text-[12px] text-[var(--text-muted)]">
                    Defaults to the most recent event; pick “General” for feedback not tied to one.
                  </span>
                  <select name="cycleId" defaultValue={cycles[0].id} className={SELECT}>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="">General — not about a specific event</option>
                  </select>
                </label>
              )}

              {fields.map((f) => (
                <FieldPreview
                  key={f.key}
                  field={toPreviewShape({ ...f, label: f.label, required: f.required ?? false })}
                  name={`field_${f.key}`}
                />
              ))}

              {form.allowAnonymous && <CheckField label="submit anonymously" name="anonymous" />}

              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Submit
              </button>
            </form>
          </section>

          {canReview && (
            <section className="mt-8">
              <SectionHeading>Responses ({responses.length})</SectionHeading>
              {responses.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {responses.map((r) => (
                  <div key={r.id} className={CARD}>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {r.submittedBy ? memberNameById.get(r.submittedBy) ?? "—" : "Anonymous"}
                      {" — "}
                      {r.cycleId ? cycleNameById.get(r.cycleId) ?? "—" : "General"}
                      {" — "}
                      {new Date(r.submittedAt).toLocaleString()}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1 text-[13px] text-[var(--text)]">
                      {fields.map((f) => {
                        const v = (r.values as Record<string, unknown>)[f.key];
                        const display = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                        return (
                          <li key={f.key}>
                            <span className="font-medium">{f.label}:</span> {display || "—"}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
