import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { RESPONSE_TYPE_NOUNS } from "@/lib/field-shape";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import DurationFields from "@/components/assemblies/DurationFields";
import {
  FOUNDING_SETTINGS_DESCRIPTION,
  FOUNDING_SETTINGS_GROUPS,
  FOUNDING_SETTINGS_ITEMS,
  FOUNDING_SETTINGS_TEMPLATE_KEY,
  FOUNDING_SETTINGS_TITLE,
} from "@/lib/assemblies";
import { proposeAssemblyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewAssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; template?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, template } = await searchParams;
  const fromTemplate = template === FOUNDING_SETTINGS_TEMPLATE_KEY;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Propose an Assembly</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        A way to gather the whole community&rsquo;s view on something — anything from a genuinely
        urgent one-off to a slower, deliberate structural question. Once proposed, it moves through
        three windows in order: <strong className="text-[var(--text)]">agenda-building</strong>, where
        anyone can add items; <strong className="text-[var(--text)]">notice</strong>, where the
        agenda is locked and readable but voting hasn&rsquo;t opened; then{" "}
        <strong className="text-[var(--text)]">voting</strong>. Results are always advisory — turning
        any of them into an actual change stays a separate, deliberate step.
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {fromTemplate ? (
        <form action={proposeAssemblyAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="templateKey" value={FOUNDING_SETTINGS_TEMPLATE_KEY} />

          <div className="rounded-[var(--radius-md)] border border-[var(--accent-1)] bg-[var(--accent-1-softer)] p-3">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">{FOUNDING_SETTINGS_TITLE}</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {FOUNDING_SETTINGS_DESCRIPTION}
            </p>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              {FOUNDING_SETTINGS_ITEMS.length} agenda items across{" "}
              {FOUNDING_SETTINGS_GROUPS.length} areas will be added as the starting agenda. You can
              remove any of them and add your own while the agenda-building window is open.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {FOUNDING_SETTINGS_GROUPS.map((group) => {
              const items = FOUNDING_SETTINGS_ITEMS.filter((i) => i.group === group.title);
              return (
                <li key={group.title} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                  <p className="text-[13px] font-medium text-[var(--text)]">{group.title}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{group.blurb}</p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {items.map((item) => (
                      <li key={item.text} className="text-[12px] text-[var(--text-muted)]">
                        · {item.text}
                        <span className="text-[var(--text)]">
                          {" "}
                          ({RESPONSE_TYPE_NOUNS[item.responseType]})
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Title</span>
            <input
              type="text"
              name="title"
              required
              defaultValue={FOUNDING_SETTINGS_TITLE}
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Description (optional)</span>
            <textarea name="description" rows={3} defaultValue={FOUNDING_SETTINGS_DESCRIPTION} className={INPUT} />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-[var(--text)]">How long should each window run?</legend>
            {/* Anchored to render time so the preview reads "from now"
                rather than drifting between server and client renders. */}
            <DurationFields now={Date.now()} />
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Proposing…">
              Propose with this agenda
            </SubmitButton>
            <Link href="/assemblies/new" className={BUTTON_SECONDARY}>
              Start from scratch instead
            </Link>
          </div>
        </form>
      ) : (
        <form action={proposeAssemblyAction} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Title</span>
            <input type="text" name="title" required className={INPUT} />
          </label>

          <label className="flex flex-col gap-1">
            <span className={LABEL}>Description (optional)</span>
            <textarea name="description" rows={4} className={INPUT} />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-[var(--text)]">
              How long should each window run?
            </legend>
            <DurationFields now={Date.now()} />
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Proposing…">
              Propose
            </SubmitButton>
            <Link
              href={`/assemblies/new?template=${FOUNDING_SETTINGS_TEMPLATE_KEY}`}
              className={BUTTON_SECONDARY}
            >
              Use the {FOUNDING_SETTINGS_TITLE} agenda
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}
