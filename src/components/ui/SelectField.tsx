import type { ReactNode, SelectHTMLAttributes } from "react";

/**
 * A `<select>` that shows the server's value after a save. A bare
 * `defaultValue` does not, and the failure is quiet enough to look like the
 * save didn't work.
 *
 * **Why a plain `<select defaultValue>` goes stale.** React treats
 * `defaultValue` on an uncontrolled input as a mount-time default, not a
 * value to keep in sync. In react-dom's `updateDOMProperties`, the `select`
 * case ends with `updateOptions` being called only when the element has a
 * `value` prop (controlled), or when the element *changes* between controlled
 * and uncontrolled:
 *
 * ```js
 * null != _propKey8                                  // has a value prop?
 *   ? updateOptions(domElement, !!multiple, _propKey8, false)
 *   : !!lastProps !== !!multiple && (                 // ← only on that flip
 *       defaultValue != null ? updateOptions(domElement, !!multiple, defaultValue, true) : ...);
 * ```
 *
 * A settings form is uncontrolled in both renders, so the second branch's
 * condition is false and `updateOptions` never runs again. The selection was
 * set once at mount and nothing re-applies it. So a Server Action that calls
 * `revalidatePath` genuinely refetches fresh data and the component genuinely
 * re-renders with the correct `defaultValue` — the browser just keeps showing
 * what was selected before, and a hard refresh looks like proof the save
 * worked when it only re-mounted the element.
 *
 * `key` is the fix because remounting is the one thing that reliably
 * re-establishes a mount-time default. Keying on the *value* rather than on
 * anything incidental means it changes exactly when the server's answer
 * changes, so an unrelated re-render (another member's edit, a nav prefetch)
 * leaves the element — and any half-made selection in it — completely alone.
 *
 * Deliberately not applied to `<input defaultValue>` or
 * `<input defaultChecked>`: React does call `setProp` for those, and since the
 * person saving is the one who last touched the control, the displayed state
 * already matches what was stored. The staleness here is specific to
 * `select`, where the pre-save selection and the post-save value are set by
 * different things.
 */
export default function SelectField({
  defaultValue,
  children,
  ...rest
}: { defaultValue?: string | null } & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "defaultValue" | "children"
> & { children: ReactNode }) {
  const selected = defaultValue ?? "";
  return (
    <select {...rest} key={selected} defaultValue={selected}>
      {children}
    </select>
  );
}
