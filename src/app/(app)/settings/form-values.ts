// Form-value helpers for the settings screen's per-card forms.
//
// The one non-obvious thing here is `checkboxOf`. An unchecked checkbox
// submits *nothing at all*, so a form that owns a toggle cannot tell
// "the person turned this off" from "this toggle isn't in my form". The
// old page dodged the problem by having one giant form per tab where
// every boolean was written unconditionally from `=== "on"`, which is
// exactly why a typo in the decision-rules JSON could roll back the door
// toggles somebody had just changed. With one card per subject (see
// ./ui.tsx), each toggle is paired with a hidden `off` input by
// ToggleField, so its key is always present in the form that owns it —
// and `undefined` is free to mean "not mine to write".

export function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export function optionalText(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}

export function number(formData: FormData, name: string): number | undefined {
  const raw = text(formData, name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalNumber(formData: FormData, name: string): number | null | undefined {
  const raw = text(formData, name);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// undefined = the toggle isn't in this form. true/false = the person
// set it. See the module comment for why the distinction is load-bearing.
//
// Reads *all* the values rather than `get`, because ToggleField posts a
// hidden "off" immediately before the box: `get` returns the first match,
// which is always that hidden field, so a naive read would report every
// toggle as off. Checking membership of "on" across the whole set is
// right for a lone box and for a group alike.
export function checkboxOf(formData: FormData, name: string): boolean | undefined {
  const values = formData.getAll(name).map(String);
  if (values.length === 0) return undefined;
  return values.includes("on") || values.includes("true") || values.includes("1");
}

// A group of toggles sharing one name (modulesEnabled). The hidden `off`
// each ToggleField posts is dropped here, so an unticked box contributes
// nothing to the list rather than the string "off" ending up in the
// module set.
export function checkboxGroup(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map(String)
    .filter((v) => v !== "off");
}

// Drops undefined so a card's action can spread the result straight into
// the shared `updateCommunityInput`, whose own `.optional()` fields then
// leave every other column of the community row alone.
export function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}
