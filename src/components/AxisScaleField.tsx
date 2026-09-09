import { AXIS_SCALE_MAX, AXIS_SCALE_MIN } from "@/lib/trait-axes";

// Shared by every place a TraitAxis value gets set — onboarding's 3
// axes, /profile's remaining ones, /propose's suggested task-side
// values, and ProposalCard's activation review. Plain radios (no client
// JS needed): a 5-point low/high scale by default, or the axis's own
// `optionLabels` (e.g. autonomy's real 3-checkbox onboarding-form
// wording, expanded to 5 slots) when set, one radio per label instead
// of a bare low/high pair.
export default function AxisScaleField({
  axis,
  name,
  defaultValue,
}: {
  axis: { id: string; lowLabel: string; highLabel: string; optionLabels: string[] };
  name: string;
  defaultValue?: number | null;
}) {
  const positions = Array.from(
    { length: AXIS_SCALE_MAX - AXIS_SCALE_MIN + 1 },
    (_, i) => AXIS_SCALE_MIN + i,
  );
  const hasOptionLabels = axis.optionLabels.length === positions.length;

  if (hasOptionLabels) {
    return (
      <div className="flex flex-col gap-1">
        {positions.map((value, i) => (
          <label key={value} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            <input type="radio" name={name} value={value} defaultChecked={defaultValue === value} />
            {axis.optionLabels[i]}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-[var(--text-muted)]">{axis.lowLabel}</span>
      <div className="flex items-center gap-3">
        {positions.map((value) => (
          <label key={value} className="flex flex-col items-center gap-0.5 text-[11px] text-[var(--text-muted)]">
            <input type="radio" name={name} value={value} defaultChecked={defaultValue === value} />
          </label>
        ))}
      </div>
      <span className="text-[12px] text-[var(--text-muted)]">{axis.highLabel}</span>
    </div>
  );
}
