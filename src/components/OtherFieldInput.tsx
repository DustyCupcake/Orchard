"use client";

import { useRef } from "react";
import { INPUT } from "@/components/ui/kit";
import { OTHER_MARKER_VALUE, otherInputName } from "@/lib/field-shape";

/**
 * The escape hatch: a marker beside a text field whose greyed placeholder
 * reads "Other".
 *
 * The only client component in the question field's rendering path, and it
 * exists for one behaviour — **typing ticks the marker** — which is what
 * makes unticking it mean something. Without the auto-tick, unticking would
 * be indistinguishable from never having found the box, and a member who
 * wrote an answer and then deliberately said "no, not that one" would be
 * indistinguishable from one who typed and never ticked. With it, the two
 * are different states, and the read side can honour the marker
 * (`fieldValueFromFormData`) without the risk of silently discarding
 * somebody's typed answer, because anything they type ticks the box first.
 *
 * A ref rather than `useState`, deliberately. The marker is an uncontrolled
 * input — React renders it from `defaultChecked` and never re-renders it —
 * so flipping `.checked` here touches the DOM once and no state update
 * follows. A state version would re-render the field on every keystroke and
 * re-render the *whole* `FieldPreview` with it, which is a cost this
 * codebase has gone out of its way not to pay elsewhere (see the
 * `LaneEditorControls` note in the settings rebuild).
 *
 * The two controls are **siblings, never nested**. The obvious way to build
 * "a checkbox next to a field" is to put the field inside the checkbox's
 * `<label>`, and then every click into the field to type toggles the
 * marker — so somebody answering in their own words fights the control that
 * is meant to be enabling them. A flex row of two siblings has no such
 * problem, and the marker carries its own label for a screen reader since it
 * has no visible text of its own.
 */
export type MarkerType = "radio" | "checkbox";

export default function OtherFieldInput({
  name,
  markerType,
  defaultValue,
  defaultChecked,
  required,
  disabled,
}: {
  /** The field's own name, which the marker shares. Omitted in the
   *  settings builders' non-submitting preview. */
  name?: string;
  markerType: MarkerType;
  defaultValue?: string;
  defaultChecked: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const marker = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={marker}
        type={markerType}
        // The same name the option list uses, and the shared marker value,
        // so nothing downstream — the reader, the validator, the prefill —
        // can tell the layout changed.
        name={name}
        value={OTHER_MARKER_VALUE}
        required={required}
        disabled={disabled}
        defaultChecked={defaultChecked}
        aria-label="Other"
        className="shrink-0"
      />
      <input
        type="text"
        name={name ? otherInputName(name) : undefined}
        defaultValue={defaultValue}
        placeholder="Other"
        aria-label="Other — please specify"
        maxLength={500}
        className={`${INPUT} flex-1`}
        // Only ever *forward*: ticks the box when it is already unticked, and
        // never unticks one the member cleared. Someone who types, un-ticks,
        // and stops has said something, and submitting must not override it.
        onChange={() => {
          if (marker.current && !marker.current.checked) marker.current.checked = true;
        }}
      />
    </div>
  );
}
