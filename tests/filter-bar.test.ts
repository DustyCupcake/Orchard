import { describe, expect, it, vi } from "vitest";
import { chipFor, type FilterField } from "@/components/ui/FilterBar";

const noop = () => {};

describe("chipFor", () => {
  it("shows nothing for a field that is not filtering", () => {
    const off: FilterField[] = [
      { id: "a", label: "A", kind: "toggle", checked: false, onChange: noop },
      { id: "b", label: "B", kind: "select", value: null, options: [], onChange: noop },
      { id: "c", label: "C", kind: "multi", values: [], options: [], onChange: noop },
      { id: "d", label: "D", kind: "range", inputType: "date", from: null, to: null, onChange: noop },
    ];
    expect(off.map(chipFor)).toEqual([null, null, null, null]);
  });

  it("words a toggle, a select and a multi", () => {
    const toggle = chipFor({ id: "a", label: "Has open slots", kind: "toggle", checked: true, chipLabel: "Free slots", onChange: noop });
    expect(toggle?.text).toBe("Free slots");
    expect(chipFor({ id: "a", label: "Has open slots", kind: "toggle", checked: true, onChange: noop })?.text).toBe("Has open slots");
    const options = [
      { value: "v1", label: "Veg" },
      { value: "v2", label: "Fruit" },
    ];
    expect(chipFor({ id: "b", label: "Branch", kind: "select", value: "v1", options, onChange: noop })?.text).toBe("Branch: Veg");
    expect(chipFor({ id: "c", label: "Tags", kind: "multi", values: ["v1", "v2"], options, onChange: noop })?.text).toBe("Tags: Veg, Fruit");
  });

  it("words a range by which ends are set", () => {
    const base = { id: "d", label: "Time", kind: "range", inputType: "time", onChange: noop } as const;
    expect(chipFor({ ...base, from: "18:00", to: null })?.text).toBe("Time: from 18:00");
    expect(chipFor({ ...base, from: null, to: "22:00" })?.text).toBe("Time: until 22:00");
    expect(chipFor({ ...base, from: "18:00", to: "22:00" })?.text).toBe("Time: 18:00 – 22:00");
    expect(chipFor({ ...base, from: "2027-03-06", to: null, format: (v) => v.toUpperCase() + "!" })?.text).toBe("Time: from 2027-03-06!");
  });

  it("removing a chip clears just that field", () => {
    const onChange = vi.fn();
    chipFor({ id: "c", label: "Tags", kind: "multi", values: ["x"], options: [], onChange })?.remove();
    expect(onChange).toHaveBeenCalledWith([]);
    const onRange = vi.fn();
    chipFor({ id: "d", label: "Days", kind: "range", inputType: "date", from: "2027-03-01", to: null, onChange: onRange })?.remove();
    expect(onRange).toHaveBeenCalledWith({ from: null, to: null });
  });
});
