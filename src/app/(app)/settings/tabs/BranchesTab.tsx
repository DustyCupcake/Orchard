import type { branch as branchTable } from "@/db/schema";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SelectField, SettingsCard, SettingsPanel, SettingsSection, TextField } from "../ui";
import {
  confirmPendingBranchAction,
  createBranchAction,
  deleteBranchAction,
  rejectPendingBranchAction,
  updateBranchAction,
} from "../actions";

// A tri-state, not a checkbox: a branch inherits the community's call
// defaults, and "inherit" is the interesting third state — the old form
// offered on/off/inherit as three raw selects with no explanation of what
// inheriting meant, which made it the option nobody understood and
// everybody avoided.
const TRISTATE_OPTIONS = [
  { value: "inherit", label: "Use the community's default" },
  { value: "on", label: "Always required here" },
  { value: "off", label: "Never required here" },
];

export default function BranchesTab({
  confirmedBranches,
  pendingBranches,
}: {
  confirmedBranches: (typeof branchTable.$inferSelect)[];
  pendingBranches: (typeof branchTable.$inferSelect)[];
}) {
  return (
    <div className="flex flex-col gap-8">
      {pendingBranches.length > 0 && (
        <SettingsSection
          title="Waiting on a decision"
          description="A Task Pack import created these from someone who didn't hold Admins at the time. The tasks are already attached and claimable; confirming locks the branch in, rejecting re-points them at a real one instead."
        >
          <div className="flex flex-col gap-2">
            {pendingBranches.map((b) => (
              <div
                key={b.id}
                className="rounded-[var(--radius-md)] p-3"
                style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-[var(--text)]">{b.name}</span>
                  <Tag tone="warning">pending</Tag>
                </div>
                {b.description && (
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">{b.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={confirmPendingBranchAction}>
                    <input type="hidden" name="branchId" value={b.id} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Confirm
                    </button>
                  </form>
                  <form action={rejectPendingBranchAction} className="flex items-center gap-2">
                    <input type="hidden" name="branchId" value={b.id} />
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Or reassign its tasks to</span>
                      <select name="reassignToBranchId" required defaultValue="" className={INPUT}>
                        <option value="" disabled>
                          — pick a branch —
                        </option>
                        {confirmedBranches.map((cb) => (
                          <option key={cb.id} value={cb.id}>
                            {cb.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Branches"
        description="Every task, shift, call and poll belongs to a branch. Branches are how a community splits its own work up without splitting itself in two — and why one can't be deleted out from under the tasks already in it."
      >
        {confirmedBranches.length === 0 && (
          <SettingsPanel>
            <p className="text-[13px] text-[var(--text-muted)]">
              No branches yet. A community with none can&rsquo;t hold a task, so this is the first
              thing to set up.
            </p>
          </SettingsPanel>
        )}

        {confirmedBranches.map((b) => (
          <SettingsCard
            key={b.id}
            action={updateBranchAction}
            submitLabel="Save branch"
            title={b.name}
            stateLabel={`${b.name}, a branch. Its description and its call defaults`}
            state={
              <>
                {b.description?.trim() || "No description yet."}{" "}
                {b.defaultCallHasAgenda === null &&
                b.defaultCallNeedsSummary === null &&
                b.defaultCallRequireRead === null ? (
                  <>Calls use the community defaults.</>
                ) : (
                  <>
                    Calls here need{" "}
                    {[
                      b.defaultCallHasAgenda === true ? "an agenda" : b.defaultCallHasAgenda === false ? "no agenda" : null,
                      b.defaultCallNeedsSummary === true ? "a summary" : b.defaultCallNeedsSummary === false ? "no summary" : null,
                      b.defaultCallRequireRead === true ? "read confirmation" : b.defaultCallRequireRead === false ? "no read confirmation" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "nothing beyond the community default"}
                    .
                  </>
                )}
              </>
            }
            aside={
              <form action={deleteBranchAction}>
                <input type="hidden" name="branchId" value={b.id} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Delete
                </button>
              </form>
            }
          >
            <input type="hidden" name="branchId" value={b.id} />
            <TextField label="Name" name="name" defaultValue={b.name} required />
            <TextAreaish
              label="What this branch is for"
              name="description"
              defaultValue={b.description ?? ""}
            />
            <SelectField
              label="Calls need an agenda"
              name="defaultCallHasAgenda"
              defaultValue={triState(b.defaultCallHasAgenda)}
              options={TRISTATE_OPTIONS}
            />
            <SelectField
              label="Calls need a summary"
              name="defaultCallNeedsSummary"
              defaultValue={triState(b.defaultCallNeedsSummary)}
              options={TRISTATE_OPTIONS}
            />
            <SelectField
              label="Summaries need reading"
              name="defaultCallRequireRead"
              defaultValue={triState(b.defaultCallRequireRead)}
              options={TRISTATE_OPTIONS}
            />
          </SettingsCard>
        ))}

        <SettingsCard
          action={createBranchAction}
          submitLabel="Create branch"
          title="Add a branch"
          affordance="Create"
          description="One sentence on what it's for is enough. Everything else is filled in later."
        >
          <TextField label="Name" name="name" required />
          <TextAreaish label="What it's for" name="description" />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function TextAreaish({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex max-w-[420px] flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <textarea name={name} rows={2} defaultValue={defaultValue} className={`${INPUT} disabled:opacity-60`} />
    </label>
  );
}

function triState(value: boolean | null) {
  return value === null ? "inherit" : value ? "on" : "off";
}
