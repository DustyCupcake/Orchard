import type { form as formTable } from "@/db/schema";
import { BUTTON_SECONDARY, Tag } from "@/components/ui/kit";
import { SettingsCard, SettingsSection } from "../ui";
import { archiveFormAction, createFormAction, unarchiveFormAction, updateFormAction } from "../actions";
import FormBuilder from "../FormBuilder";
import { toEditableFieldShape } from "@/lib/field-shape";
import type { FormField } from "@/lib/forms";

function toBuilderFields(fields: FormField[]) {
  return fields.map((field) => ({
    key: field.key,
    ...toEditableFieldShape({
      label: field.label,
      responseType: field.responseType,
      options: field.options,
      required: field.required,
      multiline: field.multiline,
      validation: field.validation,
      allowOther: field.allowOther,
      min: field.min,
      max: field.max,
      step: field.step,
      isNameField: field.isNameField,
      isEmailField: field.isEmailField,
      mapsToProfileQuestionId: field.mapsToProfileQuestionId,
    }),
  }));
}

export default function FormsTab({
  forms,
  profileQuestionOptions,
}: {
  forms: (typeof formTable.$inferSelect)[];
  profileQuestionOptions: { id: string; label: string }[];
}) {
  return (
    <SettingsSection
      title="Forms"
      description="Every set of questions in the app is a form — the application, post-event feedback, scheduling polls, anything. A form can be tagged so a field maps onto a profile question, which is how a person's application fills in their own profile instead of asking twice."
    >
      {forms.length === 0 && (
        <p className="text-[13px] text-[var(--text-muted)]">
          No forms yet. The application needs one before any lane that asks for a form has anything
          to ask with.
        </p>
      )}

      {forms.map((f) => (
        <div
          key={f.id}
          className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4"
          style={f.archivedAt ? { opacity: 0.6 } : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-medium text-[var(--text)]">{f.title}</h3>
            {f.allowAnonymous && <Tag>anonymous submissions</Tag>}
            {f.archivedAt && <Tag tone="warning">archived</Tag>}
          </div>
          {f.description && (
            <p className="mt-1 max-w-[560px] text-[12px] text-[var(--text-muted)]">{f.description}</p>
          )}
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {(f.fields as FormField[]).map((field) => field.label).join(" · ") || "No fields yet"}
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--accent-1)]">
              Edit this form
            </summary>
            <div className="mt-3">
              <FormBuilder
                action={updateFormAction}
                mode="edit"
                formId={f.id}
                initialTitle={f.title}
                initialDescription={f.description ?? ""}
                initialAllowAnonymous={f.allowAnonymous}
                initialFields={toBuilderFields(f.fields as FormField[])}
                profileQuestionOptions={profileQuestionOptions}
                submitLabel="Save form"
              />
            </div>
          </details>

          <form action={f.archivedAt ? unarchiveFormAction : archiveFormAction} className="mt-3">
            <input type="hidden" name="formId" value={f.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              {f.archivedAt ? "Unarchive" : "Archive"}
            </button>
          </form>
        </div>
      ))}

      <SettingsCard
        action={createFormAction}
        submitLabel="Create form"
        title="New form"
        description="Start with the questions. You can reorder, rewrite and archive afterwards without losing anything that has already been answered."
      >
        <FormBuilder
          action={createFormAction}
          mode="create"
          initialTitle=""
          initialDescription=""
          initialAllowAnonymous={false}
          initialFields={[]}
          profileQuestionOptions={profileQuestionOptions}
          submitLabel="Create form"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
