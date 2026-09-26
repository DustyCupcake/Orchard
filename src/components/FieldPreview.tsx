import { INPUT } from "@/components/ui/kit";
import {
  optionsWithOther,
  otherInputName,
  toFieldShape,
  type FieldShape,
  type ResponseType,
} from "@/lib/field-shape";

// The one real render path for "what does answering this field look
// like" — shared by /apply, /feedback (real, submittable renders),
// /questions + /profile's ProfileQuestionForm, and the settings
// Form/ProfileQuestion builders' own live preview
// (docs/development-plan.md's Phase 58, disabled). No "use client"
// needed: nothing here owns state or an event handler, so it's safe to
// render from a Server Component (the two real pages) or from inside a
// client component (the builder's preview pane) equally — the same
// component either way is what actually guarantees "exactly as a
// submitter would see it," not just a visual approximation of it.
//
// Takes a FieldShape rather than the individual flags so a Form's jsonb
// entry and a ProfileQuestion row can both be handed to it after
// toFieldShape, and so adding a type or a flag is an edit here and in
// field-shape.ts rather than in four places that render fields.
//
// Deliberately plain HTML inputs, no JS. The one piece of interactivity a
// field really needs — the "other" escape hatch's text input appearing
// once its option is picked — is handled by the browser natively: the
// input is always rendered and simply ignored unless the marker is
// selected, which validateFieldValue then reads accordingly. A
// useEffect to show/hide it would buy nothing and would mean this stops
// being server-renderable.
export type FieldPreviewShape = FieldShape & { label: string; required: boolean };

export function toPreviewShape(input: {
  label: string;
  required: boolean;
  responseType: ResponseType;
  options?: string[] | null;
  multiline?: boolean | null;
  validation?: FieldShape["validation"] | null;
  allowOther?: boolean | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
}): FieldPreviewShape {
  return { label: input.label, required: input.required, ...toFieldShape(input) };
}

// The extra text input that backs the "other" option. A sibling name
// rather than the same one as the radio/checkbox — see
// field-shape.ts's otherInputName for why the two must not collide.
function OtherInput({ name, defaultValue }: { name?: string; defaultValue?: string }) {
  return (
    <input
      type="text"
      name={name ? otherInputName(name) : undefined}
      defaultValue={defaultValue}
      placeholder="Tell us in your own words"
      aria-label="Other — please specify"
      maxLength={500}
      className={`${INPUT} mt-1`}
    />
  );
}

export default function FieldPreview({
  field,
  name,
  disabled,
  defaultValue,
  hideLabel,
}: {
  field: FieldPreviewShape;
  // Omitted in preview mode (disabled=true) — nothing there ever
  // submits, so there's no real field to name.
  name?: string;
  disabled?: boolean;
  // This field's existing answer, so an "edit what you already said"
  // surface (Profile's "Your answers", the Dashboard's prefilled-answer
  // review) renders the real value rather than an empty box. Deliberately
  // part of the shared renderer rather than a prop each caller threads
  // into its own inputs — there is no way to prefill a field that
  // doesn't render the field.
  defaultValue?: unknown;
  // For callers that already show the label themselves and pass an empty
  // one to avoid a duplicate heading. Explicit rather than inferred from
  // an empty label, because in the settings builder an empty label is
  // itself useful feedback ("untitled field") and must keep rendering.
  hideLabel?: boolean;
}) {
  const { label, required, responseType, options, multiline, allowOther, min, max, step, validation } = field;
  const fullOptions = optionsWithOther(field);

  // The prefill, resolved per type once here instead of at each input.
  const asString = typeof defaultValue === "string" ? defaultValue : "";
  const chosen = (Array.isArray(defaultValue) ? defaultValue : []).map(String);
  // A stored choice that isn't one of the options is someone's own words
  // (see field-shape.ts's validateFieldValue) — so it pre-fills the
  // escape hatch and ticks the "Other" row, rather than being dropped.
  const otherText = chosen.filter((v) => !options.includes(v));
  const otherSelected =
    allowOther &&
    (responseType === "single_choice" ? Boolean(asString) && !options.includes(asString) : otherText.length > 0);
  // The text the escape hatch should show. Only the free text, never the
  // selected option: someone who picked "they/them" from the list must not
  // come back to a form with "they/them" sitting in the Other box, where
  // re-submitting it would turn a plain option into free text.
  const otherDefault = responseType === "single_choice" ? (otherSelected ? asString : "") : (otherText[0] ?? "");

  return (
    <label className="flex flex-col gap-1.5">
      {!hideLabel && (
        <span className="text-[13px] font-medium text-[var(--text)]">
          {label || <span className="text-[var(--text-muted)]">(untitled field)</span>}
          {required ? " *" : ""}
        </span>
      )}

      {responseType === "text" && multiline && (
        <textarea
          name={name}
          required={required}
          disabled={disabled}
          rows={3}
          maxLength={2000}
          defaultValue={asString}
          className={INPUT}
        />
      )}
      {responseType === "text" && !multiline && (
        <input
          type="text"
          name={name}
          required={required}
          disabled={disabled}
          maxLength={validation === "email" ? 254 : 500}
          defaultValue={asString}
          className={INPUT}
        />
      )}

      {responseType === "boolean" && (
        // A yes/no is one field with two values, not two radios and a
        // "none" state — the unchecked box is the answer, so there's no
        // such thing as leaving it blank. That also means an optional
        // boolean genuinely has only two possible answers, which is
        // worth knowing when someone reaches for a choice list instead.
        <div className="flex items-center gap-4">
          {[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ].map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-[13px] font-normal text-[var(--text)]">
              <input
                type="radio"
                name={name}
                value={o.value}
                required={required}
                disabled={disabled}
                defaultChecked={
                  defaultValue === (o.value === "true") ||
                  asString === o.value
                }
              />{" "}
              {o.label}
            </label>
          ))}
        </div>
      )}

      {responseType === "number" && (
        <input
          type="number"
          name={name}
          required={required}
          disabled={disabled}
          min={min ?? undefined}
          max={max ?? undefined}
          step={step ?? 1}
          defaultValue={typeof defaultValue === "number" ? defaultValue : asString || undefined}
          className={`${INPUT} w-fit`}
        />
      )}

      {responseType === "date" && (
        <input
          type="date"
          name={name}
          required={required}
          disabled={disabled}
          defaultValue={asString}
          className={`${INPUT} w-fit`}
        />
      )}

      {responseType === "single_choice" && (
        <div className="flex flex-col gap-1">
          {options.length === 0 && !allowOther && (
            <span className="text-[13px] text-[var(--text-muted)]">(no options yet)</span>
          )}
          {fullOptions.map((o) => (
            <label key={o.value} className="flex flex-col text-[13px] font-normal text-[var(--text)]">
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={o.isOther ? "Other" : o.value}
                  required={required}
                  disabled={disabled}
                  defaultChecked={o.isOther ? otherSelected : asString === o.value}
                />{" "}
                {o.label}
              </span>
              {o.isOther && <OtherInput name={name} defaultValue={otherDefault} />}
            </label>
          ))}
        </div>
      )}

      {responseType === "multi_choice" && (
        <div className="flex flex-col gap-1">
          {options.length === 0 && !allowOther && (
            <span className="text-[13px] text-[var(--text-muted)]">(no options yet)</span>
          )}
          {fullOptions.map((o) => (
            <label key={o.value} className="flex flex-col text-[13px] font-normal text-[var(--text)]">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={name}
                  value={o.isOther ? "Other" : o.value}
                  disabled={disabled}
                  defaultChecked={o.isOther ? otherSelected : chosen.includes(o.value)}
                />{" "}
                {o.label}
              </span>
              {o.isOther && <OtherInput name={name} defaultValue={otherDefault} />}
            </label>
          ))}
        </div>
      )}
    </label>
  );
}
