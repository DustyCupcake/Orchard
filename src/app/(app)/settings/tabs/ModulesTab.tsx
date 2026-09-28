import type { community as communityTable, form as formTable } from "@/db/schema";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { SelectField, SettingsGroup, SettingsSection, ToggleField } from "../ui";
import { updateModulesSettingsAction, updatePostCycleFeedbackAction } from "../actions";

// A short, honest line per module: what turns off when you untick it.
// The old tab was a bare list of checkboxes with no consequences stated,
// which made "is this one important?" a question only the person who
// wrote the module could answer.
const MODULE_CONSEQUENCE: Record<string, string> = {
  sensitive_data: "The sensitive-fields layer. Turning it off doesn't un-mark anything you've already marked sensitive — it stops the access rules from being enforced.",
  budget: "Budget cycles, proposals and voting. Data stays; the pages go.",
  event_scheduling: "Event proposals, review and the published Programme.",
  shifts: "Shift series, sign-ups and confirmations.",
  recruitment: "Invites, applications, the pipeline and mediation. Turn this off and the Recruitment tab below stops mattering.",
  spatial_planning: "Plots, zones, placements and the collaboration surface.",
  kitchen: "Menus, dishes and the food-ideas inbox.",
};

export default function ModulesTab({
  community,
  forms,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="What's switched on"
        description="Each of these is a whole area of the app. Nothing here is on by default except what you see ticked — a community that turns everything on is opting into maintaining all of it."
      >
        <SettingsGroup
          action={updateModulesSettingsAction}
          submitLabel="Save modules"
          title="Modules"
          state={
            community.modulesEnabled.length === 0
              ? "None switched on — Orchard is running as a task board and nothing else"
              : `${community.modulesEnabled.length} of ${MODULE_DEFINITIONS.length} on: ${MODULE_DEFINITIONS.filter((m) => community.modulesEnabled.includes(m.key)).map((m) => m.label).join(", ")}`
          }
          description="Untick to hide a module's pages. Existing records stay exactly where they are and come back if you retick."
        >
          {MODULE_DEFINITIONS.map((m) => (
            <ToggleField
              key={m.key}
              label={m.label}
              name="modulesEnabled"
              value={m.key}
              defaultChecked={community.modulesEnabled.includes(m.key)}
              hint={MODULE_CONSEQUENCE[m.key]}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="After an event"
        description="One standing question, asked once an event is over, of everyone in it."
      >
        <SettingsGroup
          action={updatePostCycleFeedbackAction}
          submitLabel="Save feedback form"
          title="The feedback ask"
          state={
            forms.find((f) => f.id === community.postCycleFeedbackFormId)
              ? `Sent after every event: "${forms.find((f) => f.id === community.postCycleFeedbackFormId)!.title}"`
              : "No form chosen — nobody is asked anything after an event"
          }
          description="Which form to send out once an event closes. Without one there's no ask at all — the platform has no default question to put to anybody."
        >
          <SelectField
            label="Feedback form"
            name="postCycleFeedbackFormId"
            defaultValue={community.postCycleFeedbackFormId ?? ""}
            wide
            options={[
              { value: "", label: "— none —" },
              ...forms
                .filter((f) => !f.archivedAt)
                .map((f) => ({ value: f.id, label: f.title })),
            ]}
            hint="Build it under the Forms tab. Who reviews the answers is a permission, not a setting — see Access & permissions."
          />
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
