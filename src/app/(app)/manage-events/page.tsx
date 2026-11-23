import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listCycles, previewClonePreviousCycle } from "@/lib/cycles";
import { listTaskPacks } from "@/lib/task-packs";
import { listCycleTypes } from "@/lib/settings";
import { ClonePreviewGrid, ClonePreviewList } from "@/components/ClonePreview";
import SelectField from "@/components/ui/SelectField";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { createCycleAction } from "@/app/(app)/[cycleScope]/participation/actions";
import { listOpenEventParticipationCards } from "@/lib/participation";
import { SettingsCard, SettingsPanel, SettingsSection, TextField, SelectField as SettingsSelectField } from "../settings/ui";
import { createCycleTypeAction, deleteCycleTypeAction, updateCycleTypeAction } from "../settings/actions";
import type { cycle as cycleTable, member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;
type Cycle = typeof cycleTable.$inferSelect;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

export default async function ManageEventsPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect("/login");
  const allCycles = await listCycles(viewing);
  const openCycle = allCycles.find((c) => !c.closedAt) ?? null;
  const [cycleTypes, taskPacks] = await Promise.all([listCycleTypes(viewing), listTaskPacks(viewing)]);
  const cycles = allCycles;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Manage events"
        description="The community's events — open one for its dates and rules, and its settings are one click away from each event's page. Types below define what they can be, and a new one can be started below that."
      />

      <EventIndex viewing={viewing} allCycles={allCycles} />
<SettingsSection
        title="Event types"
        description="What kind of thing an event is — a season, a weekend, a rehearsal. Used for counting and for starting a new event from the last one of the same kind."
      >
        {cycleTypes.length === 0 && (
          <SettingsPanel>
            <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
              None yet. Event types are optional — an event can simply be an event.
            </p>
          </SettingsPanel>
        )}
        {cycleTypes.map((t) => (
          <SettingsCard
            key={t.id}
            action={updateCycleTypeAction}
            submitLabel="Save type"
            title={t.name}
            stateLabel={`${t.name}, an event type. What a new one of this type is proposed from`}
            state={
              t.defaultPackId
                ? `A new one is proposed from the saved pack "${taskPacks.find((p) => p.id === t.defaultPackId)?.name ?? "a pack that no longer exists"}".`
                : t.defaultSourceCycleId
                  ? `A new one is proposed as a copy of "${cycles.find((c) => c.id === t.defaultSourceCycleId)?.name ?? "an event that no longer exists"}".`
                  : "A new one starts from nothing."
            }
            aside={
              <form action={deleteCycleTypeAction}>
                <input type="hidden" name="cycleTypeId" value={t.id} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Delete
                </button>
              </form>
            }
          >
            <input type="hidden" name="cycleTypeId" value={t.id} />
            <TextField label="Name" name="name" defaultValue={t.name} required />
            <SettingsSelectField
              label="Start from a copy of"
              name="defaultSourceCycleId"
              defaultValue={t.defaultSourceCycleId ?? ""}
              wide
              options={[
                { value: "", label: "— start from nothing —" },
                ...cycles.map((c) => ({ value: c.id, label: c.name })),
              ]}
              hint="Which existing event a new one of this type is proposed as a copy of. A starting point, not a template you can rely on — everything in it is editable."
            />
            <SettingsSelectField
              label="And from this saved pack"
              name="defaultPackId"
              defaultValue={t.defaultPackId ?? ""}
              wide
              options={[
                { value: "", label: "— no pack —" },
                ...taskPacks.map((p) => ({ value: p.id, label: p.name })),
              ]}
              hint="A Task Pack carries the tasks and structure across, which is usually a better starting point than a copy of one event."
            />
          </SettingsCard>
        ))}
        <SettingsCard
          action={createCycleTypeAction}
          submitLabel="Create type"
          title="Add an event type"
          affordance="Create"
        >
          <TextField label="Name" name="name" required />
          <SettingsSelectField
            label="Start from a copy of"
            name="defaultSourceCycleId"
            defaultValue=""
            wide
            options={[{ value: "", label: "— start from nothing —" }, ...cycles.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <SettingsSelectField
            label="And from this saved pack"
            name="defaultPackId"
            defaultValue=""
            wide
            options={[{ value: "", label: "— no pack —" }, ...taskPacks.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </SettingsCard>
      </SettingsSection>

      <StartNewCycleSection
        viewing={viewing}
        cycleScope="active"
        hasPreviousCycle={allCycles.length > 0}
        openCycleName={openCycle?.name ?? null}
        previewView="grid"
      />
    </main>
  );
}

async function EventIndex({ viewing, allCycles }: { viewing: Member; allCycles: Cycle[] }) {
  // The same call /community's event cards use, so the numbers here and
  // there cannot disagree. It only covers open events; closed ones need
  // nothing but a name and dates, which allCycles already has.
  const openCards = await listOpenEventParticipationCards(viewing);
  const closedCycles = allCycles
    .filter((c) => c.closedAt)
    .sort((a, b) => (b.closedAt!.getTime() - a.closedAt!.getTime()));

  if (allCycles.length === 0) {
    return (
      <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
        No events yet. Until one exists there&rsquo;s nothing to declare participation against.
      </p>
    );
  }

  return (
    <section className="mt-6 flex flex-col gap-2">
      {openCards.map((c) => (
        <div key={c.id} className={`${CARD} flex flex-wrap items-baseline justify-between gap-2`}>
          <Link
            href={`/${c.id}/participation`}
            className="block flex-1 transition-colors hover:text-[var(--accent-1)]"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{c.name}</span>
              {c.myStatus !== "unknown" && (
                <Tag tone={c.myStatus === "coming" ? "success" : c.myStatus === "maybe" ? "warning" : undefined}>
                  {PARTICIPATION_LABEL[c.myStatus]}
                </Tag>
              )}
            </div>
            <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {dateRange(c.startDate, c.endDate)}
              {c.capacity !== null && (
                <>
                  {" · "}
                  {c.comingCount} coming
                  {c.remainingCapacity !== null && c.remainingCapacity > 0 && ` · ${c.remainingCapacity} place${c.remainingCapacity === 1 ? "" : "s"} left`}
                  {c.remainingCapacity !== null && c.remainingCapacity === 0 && " · full"}
                </>
              )}
              {c.capacity === null && c.comingCount > 0 && ` · ${c.comingCount} coming`}
            </p>
          </Link>
          <Link
            href={`/${c.id}/settings`}
            title="Open the event's settings"
            className="text-[length:var(--text-meta)] text-[var(--text-muted)] hover:underline"
          >
            Edit
          </Link>
        </div>
      ))}

      {/* Closed events collapse. A community with a long history would
          otherwise open this page onto a wall of dead cards, and the thing
          a reader wants first is what is happening *now* — the count is in
          the summary so the history's size is known before opening it. */}
      {closedCycles.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
            {closedCycles.length} past event{closedCycles.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {closedCycles.map((c) => (
              <Link
                key={c.id}
                href={`/${c.id}/participation`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-body)] transition-colors hover:border-[var(--accent-1)]"
                style={{ opacity: 0.75 }}
              >
                <span className="font-medium text-[var(--text)]">{c.name}</span>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {dateRange(c.startDate, c.endDate)}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function dateRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return "No dates set yet";
}

const PARTICIPATION_LABEL = {
  coming: "You're coming",
  maybe: "Maybe",
  not_coming: "Not coming",
} as const;



// "The Pack import review screen gains the date preview" —
// docs/plans/development-plan.md's Phase 44. This is that screen's minimal
// real form: preview a hypothetical clone (calendar or list, toggled
// by the reviewer) before committing to anything, then create for real
// below. `openCycleName` (Phase 65) drives the already-open-cycle
// confirmation — a required checkbox rather than a separate resubmit
// step, since this form's other fields (name, source, cycle type)
// would otherwise need to survive a full confirm/resubmit round trip.
async function StartNewCycleSection({
  viewing,
  cycleScope,
  hasPreviousCycle,
  openCycleName,
  previewStart,
  previewEnd,
  previewView,
}: {
  viewing: Member;
  cycleScope: string;
  hasPreviousCycle: boolean;
  openCycleName: string | null;
  previewStart?: string;
  previewEnd?: string;
  previewView: "grid" | "list";
}) {
  const [cycleTypes, packs, preview] = await Promise.all([
    listCycleTypes(viewing),
    listTaskPacks(viewing),
    hasPreviousCycle && (previewStart || previewEnd)
      ? previewClonePreviousCycle(viewing, previewStart || null, previewEnd || null)
      : Promise.resolve(null),
  ]);
  const packNameById = new Map(packs.map((p) => [p.id, p.name]));
  // "Correctly pre-selects that pack when starting a new Cycle of that
  // type" — see docs/plans/development-plan.md's Phase 55 Done-when. No
  // client JS to pre-fill one <select> from another's chosen value, so
  // this is a plain, static link straight into the real import review
  // screen instead — already carrying the right pack and cycle type.
  const typesWithDefaultPack = cycleTypes.filter((t) => t.defaultPackId && packNameById.has(t.defaultPackId));

  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <SectionHeading>Start a new event</SectionHeading>

      {typesWithDefaultPack.length > 0 && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Quick-start from an Event type&rsquo;s default pack</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-body)]">
            {typesWithDefaultPack.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task-packs/import/${t.defaultPackId}?cycleTypeId=${t.id}&cycleName=${encodeURIComponent(t.name)}`}
                  className="text-[var(--accent-1)] hover:underline"
                >
                  Start a new {t.name} event from &ldquo;{packNameById.get(t.defaultPackId!)}&rdquo;
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPreviousCycle && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Preview a clone</h3>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            See what cloning the most recent event would resolve to against a hypothetical
            start/end, before committing to anything. Reuses the exact same recompute the real
            event settings form above uses, so this always matches what actually lands once you
            create the clone and set its dates for real.
          </p>
          <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Hypothetical start</span>
              <input type="date" name="previewStart" defaultValue={previewStart ?? ""} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Hypothetical end</span>
              <input type="date" name="previewEnd" defaultValue={previewEnd ?? ""} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>View</span>
              <select name="previewView" defaultValue={previewView} className={INPUT}>
                <option value="grid">Calendar</option>
                <option value="list">List</option>
              </select>
            </label>
            <button type="submit" className={BUTTON_SECONDARY}>
              Preview
            </button>
          </form>

          {preview &&
            (previewView === "list" ? <ClonePreviewList preview={preview} /> : <ClonePreviewGrid preview={preview} />)}
        </div>
      )}

      {openCycleName && (
        <div className="mt-4">
          <Banner tone="warning">
            &ldquo;{openCycleName}&rdquo; is already open — starting another event won&rsquo;t close it.
          </Banner>
        </div>
      )}

      <form action={createCycleAction} className="mt-4 flex max-w-[400px] flex-col gap-2">
        <input type="hidden" name="cycleScope" value={cycleScope} />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input type="text" name="name" required className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Source</span>
          <SelectField name="source" defaultValue={hasPreviousCycle ? "clone_previous" : "blank"} className={INPUT}>
            <option value="blank">Blank</option>
            {hasPreviousCycle && <option value="clone_previous">Clone the most recent event</option>}
          </SelectField>
        </label>
        {cycleTypes.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Event type (optional)</span>
            <select name="cycleTypeId" defaultValue="" className={INPUT}>
              <option value="">No event type</option>
              {cycleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Start date (optional)</span>
          <input type="date" name="startDate" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>End date (optional)</span>
          <input type="date" name="endDate" className={INPUT} />
        </label>
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Setting a clone&rsquo;s dates here resolves its phased boundaries and re-derives its shift
          roster&rsquo;s occurrence timestamps immediately; a clone started without them defers the
          shift occurrences until you set dates in the event settings form above.
        </p>
        {openCycleName && <CheckField label="I understand — start anyway" name="confirmed" />}
        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Create
        </button>
      </form>
    </section>
  );
}
