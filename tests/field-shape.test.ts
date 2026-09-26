import { describe, expect, it } from "vitest";
import {
  RESPONSE_TYPE_HINTS,
  RESPONSE_TYPE_LABELS,
  RESPONSE_TYPE_NOUNS,
  RESPONSE_TYPES,
  TEXT_VALIDATIONS,
  fieldValueFromFormData,
  formatFieldValue,
  isChoiceType,
  isTextType,
  otherInputName,
  responseTypeNoun,
  toFieldShape,
  validateFieldValue,
} from "@/lib/field-shape";

// The module every question system now reads its shapes and answers
// through: ProfileQuestion, Form submissions, input-round questions and
// Assembly agenda items. Most of its behaviour is covered where it's used
// (forms.test.ts, profile-questions.test.ts, input-rounds.test.ts,
// assemblies.test.ts); what's here is the parts that have no single call
// site, and so would go untested if only the users were.
describe("field shape: the type lists", () => {
  it("has a label, a hint and a noun for every type — no gaps", () => {
    // The failure this guards against is concrete: QuestionShape used to
    // treat "not a choice" as "is prose", and printed "Everyone answers
    // in their own words" under a date question. A lookup can't drift
    // like that, but only while every key is present.
    for (const type of RESPONSE_TYPES) {
      expect(RESPONSE_TYPE_LABELS[type], `label for ${type}`).toBeTruthy();
      expect(RESPONSE_TYPE_HINTS[type], `hint for ${type}`).toBeTruthy();
      expect(RESPONSE_TYPE_NOUNS[type], `noun for ${type}`).toBeTruthy();
    }
    expect(Object.keys(RESPONSE_TYPE_LABELS).sort()).toEqual([...RESPONSE_TYPES].sort());
  });

  it("capitalises the noun for a label, and falls back to the raw value", () => {
    expect(responseTypeNoun("text")).toBe("Written answer");
    expect(responseTypeNoun("single_choice")).toBe("Pick one");
    // A row's response_type is read as a plain string off the column, so
    // an unrecognised value has to produce something rather than
    // `undefined` inside a tag.
    expect(responseTypeNoun("free_text")).toBe("free_text");
  });

  it("classifies the choice and text types, and answers false for anything else", () => {
    expect(RESPONSE_TYPES.filter(isChoiceType)).toEqual(["single_choice", "multi_choice"]);
    expect(RESPONSE_TYPES.filter(isTextType)).toEqual(["text"]);
    // Both take a plain string so a caller reading a row doesn't need a
    // cast, which means they have to be total.
    expect(isChoiceType("free_text")).toBe(false);
    expect(isTextType("nonsense")).toBe(false);
  });
});

// The read side of what fieldValueFromFormData writes. This is what stops
// a yes/no answer being shown to a member as the word "false".
describe("formatFieldValue: showing a stored answer to a person", () => {
  it("says Yes and No rather than true and false", () => {
    expect(formatFieldValue(true, "boolean")).toBe("Yes");
    expect(formatFieldValue(false, "boolean")).toBe("No");
  });

  it("prints a number as a number", () => {
    expect(formatFieldValue(2500, "number")).toBe("2500");
    // 0 is a figure somebody gave, not an absent one.
    expect(formatFieldValue(0, "number")).toBe("0");
  });

  it("formats a canonical date, and leaves anything else alone", () => {
    expect(formatFieldValue("2027-03-01", "date")).toBe("Mar 1, 2027");
    // A date answer that didn't validate would have been rejected on the
    // way in, but a hand-written or legacy row shouldn't render as
    // "Invalid Date" at a member.
    expect(formatFieldValue("not a date", "date")).toBe("not a date");
    expect(formatFieldValue("2027-13-45", "date")).toBe("2027-13-45");
    // Prose that merely starts with a date is prose. This guard is the
    // reason the check is on responseType and not on the value's shape.
    expect(formatFieldValue("2027-03-01 was the deadline", "text")).toBe(
      "2027-03-01 was the deadline",
    );
  });

  it("joins a set with commas", () => {
    expect(formatFieldValue(["north", "east"], "multi_choice")).toBe("north, east");
    expect(formatFieldValue([], "multi_choice")).toBe("");
  });

  it("returns blank for an absent answer, leaving the wording to the caller", () => {
    expect(formatFieldValue(null, "text")).toBe("");
    expect(formatFieldValue(undefined, "text")).toBe("");
    expect(formatFieldValue("", "text")).toBe("");
  });
});

describe("fieldValueFromFormData: reading a submission back", () => {
  const shape = (over: Partial<Parameters<typeof toFieldShape>[0]>) =>
    toFieldShape({ responseType: "single_choice", options: ["north", "south"], ...over });

  it("lets a ticked option win over a leftover escape-hatch text", () => {
    const fd = new FormData();
    fd.append("value", "north");
    fd.append(otherInputName("value"), "the hill");
    // The sibling input is named so a real option and free text can both
    // be present in one submission without colliding on the name.
    expect(fieldValueFromFormData(shape({ allowOther: true }), fd, "value")).toBe("north");
  });

  it("uses the escape-hatch text when no option is ticked", () => {
    const fd = new FormData();
    fd.append(otherInputName("value"), "  the hill  ");
    expect(fieldValueFromFormData(shape({ allowOther: true }), fd, "value")).toBe("the hill");
  });

  it("ignores the escape-hatch text when the question doesn't offer one", () => {
    const fd = new FormData();
    fd.append(otherInputName("value"), "the hill");
    // Otherwise a stray input would put an answer on a question whose
    // options don't include it, which the validator would then reject as
    // an invalid option — a confusing error for something the member
    // couldn't see.
    expect(fieldValueFromFormData(shape({}), fd, "value")).toBe("");
  });

  it("appends the escape-hatch text to a picked set rather than replacing it", () => {
    const fd = new FormData();
    fd.append("value", "north");
    fd.append(otherInputName("value"), "the hill");
    expect(
      fieldValueFromFormData(
        shape({ responseType: "multi_choice", allowOther: true }),
        fd,
        "value",
      ),
    ).toEqual(["north", "the hill"]);
  });
});

// The one validator, reached here through the two systems that gained it
// in this change. Their own call sites are covered in input-rounds.test.ts
// and assemblies.test.ts; this pins the two decisions those systems rely
// on and would otherwise be free to disagree with the Form path about.
describe("validateFieldValue: the two decisions the shared callers depend on", () => {
  const text = toFieldShape({ responseType: "text" });

  it("treats a pick-any answer as a set, not a lone value", () => {
    const multi = toFieldShape({ responseType: "multi_choice", options: ["a", "b"] });
    expect(validateFieldValue(multi, ["a"], { allowBlank: false })).toEqual(["a"]);
    // Accepting a scalar here would store a string where the shape
    // promises a list, and every reader downstream would have to handle
    // both. No real transport is inconvenienced: checkboxes under one
    // name always submit an array.
    expect(() => validateFieldValue(multi, "a", { allowBlank: false })).toThrow(/list of choices/);
  });

  it("leaves a blank as a blank when the caller says blank is fine", () => {
    // A ProfileQuestion is answered one at a time and can be skipped.
    expect(validateFieldValue(text, "   ", { allowBlank: true })).toBeNull();
  });

  it("reports a blank with the caller's own wording when it isn't", () => {
    // Both new callers pass wording of their own, because "required" is
    // false for them: abstaining from an agenda item is a complete
    // position, and a member who pressed the button on an empty box
    // needs to be told that rather than scolded.
    expect(() => validateFieldValue(text, "", { allowBlank: false })).toThrow(/required/);
    expect(() =>
      validateFieldValue(text, "", { allowBlank: false, blankMessage: "leave this item unanswered" }),
    ).toThrow(/leave this item unanswered/);
  });

  it("does not read a false boolean or a zero as blank", () => {
    const bool = toFieldShape({ responseType: "boolean" });
    const num = toFieldShape({ responseType: "number" });
    // The single most consequential thing about widening from three types
    // to six: a truthiness-based blank check would silently discard every
    // "no" and every "0" a member ever gave.
    expect(validateFieldValue(bool, false, { allowBlank: true })).toBe(false);
    expect(validateFieldValue(num, 0, { allowBlank: true })).toBe(0);
  });

  it("applies each declared text format, and none to 'none'", () => {
    // "none" is the default on every question system, so it has to
    // accept everything — a validation that rejected prose would make
    // every free-text answer in the product an error.
    expect(
      validateFieldValue(toFieldShape({ responseType: "text" }), "not an email", {
        allowBlank: false,
      }),
    ).toBe("not an email");

    const rejects = {
      email: "not an email",
      phone: "not a phone number",
      url: "not a url",
    } as const;
    for (const validation of TEXT_VALIDATIONS) {
      if (validation === "none") continue;
      const s = toFieldShape({ responseType: "text", validation });
      expect(() => validateFieldValue(s, rejects[validation], { allowBlank: false }), validation)
        .toThrowError();
    }
  });

  it("applies a text format to a long answer as well as a short one", () => {
    // `multiline` is presentational, so the same check has to run
    // regardless of which control the answer was typed into.
    const long = toFieldShape({ responseType: "text", multiline: true, validation: "email" });
    expect(() => validateFieldValue(long, "write to me at me", { allowBlank: false })).toThrowError();
  });
});
