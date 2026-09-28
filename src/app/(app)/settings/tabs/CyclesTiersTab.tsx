import type { cycleType as cycleTypeTable, taskPack as taskPackTable, tier as tierTable } from "@/db/schema";
import { BUTTON_SECONDARY, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SelectField, SettingsCard, SettingsPanel, SettingsSection, TextField } from "../ui";
import {
  createCycleTypeAction,
  createTierAction,
  deleteCycleTypeAction,
  deleteTierAction,
  updateCycleTypeAction,
  updateTierAction,
} from "../actions";

const CRITERION_LABEL: Record<string, string> = {
  manual: "Counted by hand",
  cycle_type_count: "Automatic — from a number of events of one type",
};

export default function CyclesTiersTab({
  tiers,
  cycleTypes,
  taskPacks,
  cycles,
}: {
  tiers: (typeof tierTable.$inferSelect)[];
  cycleTypes: (typeof cycleTypeTable.$inferSelect)[];
  taskPacks: (typeof taskPackTable.$inferSelect)[];
  cycles: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Event types"
        description="What kind of thing an event is — a season, a weekend, a rehearsal. Used for counting and for starting a new event from the last one of the same kind."
      >
        {cycleTypes.length === 0 && (
          <SettingsPanel>
            <p className="text-[13px] text-[var(--text-muted)]">
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
            <SelectField
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
            <SelectField
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
          <SelectField
            label="Start from a copy of"
            name="defaultSourceCycleId"
            defaultValue=""
            wide
            options={[{ value: "", label: "— start from nothing —" }, ...cycles.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <SelectField
            label="And from this saved pack"
            name="defaultPackId"
            defaultValue=""
            wide
            options={[{ value: "", label: "— no pack —" }, ...taskPacks.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Tiers"
        description="A bar somebody has to clear. Tiers are what gate things — starting an event, holding a role, seeing a field — and each criterion is either counted by hand or derived from a number of events of one type."
      >
        {tiers.length === 0 && (
          <SettingsPanel>
            <p className="text-[13px] text-[var(--text-muted)]">
              No tiers yet. Without at least one, anything gated by a tier is unreachable.
            </p>
          </SettingsPanel>
        )}
        {tiers.map((t) => (
          <SettingsCard
            key={t.id}
            action={updateTierAction}
            submitLabel="Save tier"
            title={t.name}
            state={
              t.criterionType === "cycle_type_count" ? (
                <>
                  Reached automatically at{" "}
                  {(t.criterionConfig as { minCount?: number } | undefined)?.minCount ?? "?"} events
                  of type{" "}
                  {cycleTypes.find((c) => c.id === (t.criterionConfig as { cycleTypeId?: string } | undefined)?.cycleTypeId)
                    ?.name ?? "a type that no longer exists"}
                  .
                </>
              ) : (
                "Counted by hand — nobody is placed in this tier automatically."
              )
            }
            aside={
              <>
                <Tag>{CRITERION_LABEL[t.criterionType] ?? t.criterionType}</Tag>
                <form action={deleteTierAction} className="ml-2 inline-block">
                  <input type="hidden" name="tierId" value={t.id} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Delete
                  </button>
                </form>
              </>
            }
          >
            <input type="hidden" name="tierId" value={t.id} />
            <TextField label="Name" name="name" defaultValue={t.name} required />
            {/* The criterion itself is stated on the collapsed side now, so
                it is not repeated here. A tier whose criterion is derived
                has nothing else to edit, which is why this form is a single
                name field. */}
          </SettingsCard>
        ))}
        <SettingsCard
          action={createTierAction}
          submitLabel="Create tier"
          title="Add a tier"
          affordance="Create"
        >
          <TextField label="Name" name="name" required />
          <label className="flex max-w-[420px] flex-col gap-1">
            <span className={LABEL}>How is it counted</span>
            <select name="criterionType" defaultValue="manual" className={INPUT}>
              <option value="manual">Counted by hand</option>
              <option value="cycle_type_count">From a number of events of one type</option>
            </select>
          </label>
          <SelectField
            label="Event type"
            name="cycleTypeId"
            defaultValue=""
            options={[{ value: "", label: "— pick a type —" }, ...cycleTypes.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <TextField
            label="How many of them"
            name="minCount"
            type="number"
            hint="Only used by the automatic kind."
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
