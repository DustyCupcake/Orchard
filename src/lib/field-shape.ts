// The one definition of "a question's shape", shared by ProfileQuestion
// (src/db/schema/profile-question.ts) and Form.fields
// (src/db/schema/form.ts's jsonb) — the same sharing spec's own "Forms
// made of Questions? Partly" line describes, and that Phase 58's shared
// field builder already relied on when it made one editor drive both.
//
// Everything about *how a question is answered* lives here, deliberately
// separated from everything about *when and to whom* it's asked, which
// stays on the ProfileQuestion row (scope, phaseNameHint, required,
// requiredBy, allowDeferral, allowPreferNotToSay) and on the Form row
// (keys, name/email tagging, mapsToProfileQuestionId).
//
// The set of types is small on purpose — six — and orthogonality comes
// from three independent flags rather than a growing flat list of
// combinations. A `text` field is a text field whether it's one line or
// five and whether it's checked as an email, because those are two
// separable questions. A flat list would need short_text, long_text,
// email, long_email, phone, ... and every one of them would need its own
// branch in every validator and every renderer.

import { ConflictError } from "./errors";
// The one module imported for its date formatting, named directly rather
// than through the dates barrel so this file stays a leaf: field-shape is
// imported by server actions, client form components and (soon) the
// indicator aggregation, and a barrel pull-in from all three is a lot of
// module graph for a single Intl formatter.
import { formatExactDate } from "./dates/display";

export const RESPONSE_TYPES = ["text", "single_choice", "multi_choice", "boolean", "date", "number"] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

// Deliberately NOT a date_range: a range is two dates wearing a trench
// coat, and it recurs far more in the spatial-planning and shift data
// than in anything a person is asked directly. A community that needs
// arrival and departure dates already has Participation.arrivalDate /
// departureDate for exactly that, as real columns.

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  text: "Text",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  boolean: "Yes / no",
  date: "Date",
  number: "Number",
};

// Two more ways to describe the same six shapes, because a dropdown label
// doesn't work everywhere: `RESPONSE_TYPE_LABELS` is title-case wording
// for a closed <select>, while a question wants to say what will happen
// ("Members give a day") and a running sentence wants a short noun
// ("a date").
//
// This exists as one map rather than three because the fallback trap is
// real and already bit: each of these was hand-written per surface, and
// the moment a type was added, a surface that switched on `isChoice` and
// assumed everything else was prose fell through to the prose branch and
// confidently described a date question as "Everyone answers in their
// own words". A lookup keyed on the type can't be wrong that way.
export const RESPONSE_TYPE_HINTS: Record<ResponseType, string> = {
  text: "Everyone answers in their own words",
  single_choice: "Members choose a single answer from a list",
  multi_choice: "Members choose as many as apply",
  boolean: "Members give a yes or a no",
  date: "Members give a day",
  number: "Members give a figure",
};

export const RESPONSE_TYPE_NOUNS: Record<ResponseType, string> = {
  text: "written answer",
  single_choice: "pick one",
  multi_choice: "pick any",
  boolean: "yes or no",
  date: "a date",
  number: "a number",
};

// The noun, capitalised for use as a label or a tag. Kept here rather
// than capitalised at each call site because the capitalisation is part
// of the wording decision rather than a display detail — and because a
// caller reading a row's plain-string `response_type` needs a total
// answer, so this falls back to the raw value instead of rendering
// `undefined` inside a tag.
export function responseTypeNoun(responseType: string): string {
  const noun = RESPONSE_TYPE_NOUNS[responseType as ResponseType];
  if (!noun) return responseType;
  return noun[0].toUpperCase() + noun.slice(1);
}

export const TEXT_VALIDATIONS = ["none", "email", "phone", "url"] as const;
export type TextValidation = (typeof TEXT_VALIDATIONS)[number];

export const TEXT_VALIDATION_LABELS: Record<TextValidation, string> = {
  none: "No format check",
  email: "Email address",
  phone: "Phone number",
  url: "Web address",
};

// The name a choice field's "other" text input submits under — a sibling
// of the radio/checkbox name, not the same one. Sharing the name would
// mean the text input's value competes with the radio's, and the winner
// would depend on DOM order: someone who ticks a normal option and then
// also types in the other box would silently have their typed text
// overwrite the option they actually chose. A separate name makes it
// unambiguous — the option is authoritative, and the text is only read
// when the option list doesn't already cover what was typed.
export function otherInputName(name: string) {
  return `${name}__other`;
}

// The shape every renderer and validator reads. ProfileQuestion's row
// and a Form.fields entry both project into this; neither stores it
// verbatim, because a Form field also carries its key and role tags and
// a ProfileQuestion also carries its scope.
export type FieldShape = {
  responseType: ResponseType;
  options: string[];
  // text only. `multiline` is the short/long distinction: one line for
  // "pronouns" or "T-shirt size", a textarea for "anything the site
  // should know about your vehicle". Before this existed, free_text
  // always rendered a textarea, which was wrong for most of the things
  // people actually ask.
  multiline: boolean;
  // text only. See TEXT_VALIDATIONS.
  validation: TextValidation;
  // choice only. Appends an "Other" option backed by a text input, so
  // the vocabulary stays closed enough to aggregate while the tail of
  // the distribution is still captured — the whole point for something
  // like pronouns, where a fixed list with no escape hatch either
  // excludes people or produces free text you can't count.
  allowOther: boolean;
  // number only. min/max/step are the constraints a community needs to
  // make a number answerable at all: "hours you can give" wants a floor
  // and a step of 1, not a free decimal.
  min: number | null;
  max: number | null;
  step: number | null;
};

// What a field looks like before anyone has configured anything, and
// what a field whose type has no opinion about a given flag falls back
// to. Every renderer and validator treats absent flags as this, so a
// field stored by an older version (or a hand-written row) still works.
export const DEFAULT_FIELD_SHAPE: FieldShape = {
  responseType: "text",
  options: [],
  multiline: false,
  validation: "none",
  allowOther: false,
  min: null,
  max: null,
  step: null,
};

// Both take a plain `string` rather than the union on purpose. Every
// caller reaches for a row's `response_type` column, which drizzle types
// as the union but which arrives from JSON, a legacy value, or a
// hand-written row as something else — and a predicate that can't be
// asked that question forces a cast at each site, which is exactly where
// a wrong value would get waved through. Neither throws on an unknown
// value: they answer false, and the callers that need more say so.
export function isChoiceType(responseType: string): boolean {
  return responseType === "single_choice" || responseType === "multi_choice";
}

export function isTextType(responseType: string): boolean {
  return responseType === "text";
}

// Reads a stored field (a ProfileQuestion row, a Form.fields entry, or
// a partially-shaped object from a client) into a complete FieldShape,
// ignoring keys that don't apply to its responseType. Callers get one
// shape with every flag resolved, so no renderer or validator has to
// re-derive "does allowOther mean anything here?".
export function toFieldShape(input: {
  responseType: ResponseType;
  options?: string[] | null;
  multiline?: boolean | null;
  validation?: TextValidation | null;
  allowOther?: boolean | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
}): FieldShape {
  const choice = isChoiceType(input.responseType);
  return {
    responseType: input.responseType,
    options: choice ? (input.options ?? []) : [],
    multiline: isTextType(input.responseType) ? (input.multiline ?? false) : false,
    validation: isTextType(input.responseType) ? (input.validation ?? "none") : "none",
    allowOther: choice ? (input.allowOther ?? false) : false,
    min: input.responseType === "number" ? (input.min ?? null) : null,
    max: input.responseType === "number" ? (input.max ?? null) : null,
    step: input.responseType === "number" ? (input.step ?? null) : null,
  };
}

// Deliberately permissive rather than a spec-complete email/phone
// grammar. These are "did you roughly type the right shape of thing",
// for catching typos and for making a value usable by something that has
// to mail or dial it — not for deciding that someone's address is
// invalid. A regex that rejects a real address is far worse than one that
// lets a malformed one through to a human.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s()-]{5,}$/;
const URL_RE = /^https?:\/\/\S+$/i;

const VALIDATION_ERRORS: Record<Exclude<TextValidation, "none">, string> = {
  email: "That doesn't look like an email address",
  phone: "That doesn't look like a phone number",
  url: "That needs to be a web address starting with http:// or https://",
};

function assertTextFormat(value: string, validation: TextValidation) {
  if (validation === "none") return;
  const re = validation === "email" ? EMAIL_RE : validation === "phone" ? PHONE_RE : URL_RE;
  if (!re.test(value.trim())) {
    throw new ConflictError(VALIDATION_ERRORS[validation]);
  }
}

/** Blank by every definition that matters: undefined, null, empty/whitespace
 * string, or an empty array. Notably NOT `false` or `0` — a boolean's
 * "no" and a number's zero are real answers, and treating either as
 * "unanswered" is the kind of bug that quietly drops people from
 * counts. */
export function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// The single validation path for "is this a legal answer to this field",
// shared by ProfileQuestion answers, Form submissions, input-round
// questions and Assembly agenda items, so a value that would be rejected
// in one can't slip through another. Returns the value to store,
// normalised for its type; throws ConflictError with a message fit to
// show a person.
//
// `allowBlank` means "this field has to carry a value" — the caller
// decides whether a blank is an outright error (a required Form field,
// the whole submission) or merely means "not answered" (a
// ProfileQuestion, where the member is answering one question at a
// time and can always skip).
//
// `blankMessage` exists because a blank is only *one* of several
// possible mistakes and the systems differ on what it means. For a
// required Form field it's the whole problem: "This answer is
// required". For a task question or an agenda item, where a member is
// free to leave a question or item unanswered and usually has, a blank
// submission means they pressed the button with nothing filled in — so
// the default's "required" would be both inaccurate and mildly
// accusatory, and each system supplies wording for its own button and
// its own stakes.
export function validateFieldValue(
  shape: FieldShape,
  value: unknown,
  options: { allowBlank: boolean; blankMessage?: string },
): unknown {
  if (isBlankValue(value)) {
    if (options.allowBlank) return null;
    throw new ConflictError(options.blankMessage ?? "This answer is required");
  }

  switch (shape.responseType) {
    case "text": {
      // A text field is always stored as a plain string, including the
      // multiline one — the distinction is presentational (input vs
      // textarea) and re-parsing it out of stored data would be noise.
      const text = Array.isArray(value) ? String(value[value.length - 1] ?? "") : String(value);
      assertTextFormat(text, shape.validation);
      return text;
    }

    case "boolean": {
      // Real booleans, not "true"/"false" strings — an aggregate that
      // counts a boolean shouldn't have to re-parse before it can sum.
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw new ConflictError("This answer needs to be yes or no");
    }

    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new ConflictError("This answer needs to be a number");
      if (shape.min !== null && n < shape.min) {
        throw new ConflictError(`This answer needs to be at least ${shape.min}`);
      }
      if (shape.max !== null && n > shape.max) {
        throw new ConflictError(`This answer needs to be at most ${shape.max}`);
      }
      return n;
    }

    case "date": {
      const s = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
        throw new ConflictError("This answer needs to be a date");
      }
      return s;
    }

    case "single_choice": {
      const s = Array.isArray(value) ? String(value[value.length - 1] ?? "") : String(value);
      if (shape.options.includes(s)) return s;
      // Not an option, but the field has an escape hatch, so this is
      // someone's own words. Stored as a plain string in the option's
      // own slot rather than a tagged pair: an aggregate then needs no
      // special case to count the options, and the rare case of a typed
      // answer that happens to equal an option label is harmless —
      // they said the same thing either way.
      if (shape.allowOther) return s.trim();
      throw new ConflictError("That isn't one of the options");
    }

    case "multi_choice": {
      // Strictly an array, not "coerce a lone value into one". A
      // pick-any answer is a set, and a scalar reaching here means a
      // client sent something malformed: accepting it would store a
      // string where the shape promises a list, and every reader
      // downstream would have to handle both. (Checkboxes under one
      // input name always submit an array, so no real transport is
      // inconvenienced by this.) An empty array never gets here — it's
      // caught by the blank check above, which is right for an
      // optional question and produces "required" for a Form field.
      if (!Array.isArray(value)) {
        throw new ConflictError("This answer needs to be a list of choices");
      }
      const values = value.map(String);
      const chosen = values.filter((v) => shape.options.includes(v));
      const freeText = values.filter((v) => !shape.options.includes(v));
      if (!shape.allowOther && freeText.length > 0) {
        throw new ConflictError("That isn't one of the options");
      }
      // At most one piece of free text, and it has to be something. An
      // escape hatch that accepted two would make the tail of the
      // distribution impossible to read back as one answer.
      if (freeText.length > 1) {
        throw new ConflictError("Only one answer can be given in your own words");
      }
      if (freeText.length === 1 && !freeText[0].trim()) {
        throw new ConflictError("An answer in your own words can't be blank");
      }
      return chosen.length > 0 || freeText.length > 0 ? [...chosen, ...freeText.map((t) => t.trim())] : [];
    }
  }
}

// The column values a FieldShape writes, with every flag that doesn't
// apply to its responseType zeroed. Both createProfileQuestion and
// updateProfileQuestion go through this rather than copying input.fields
// across by hand, so "switching a question to single_choice clears its
// stale min/max/step" is one rule in one place instead of two that can
// disagree. Deliberately NOT exported as the update's own logic: an
// update that changes only the label must not rewrite the other columns,
// so callers pass the *effective* (current merged with incoming) shape.
export function fieldShapeColumnValues(shape: FieldShape): {
  options: string[];
  multiline: boolean;
  validation: TextValidation;
  allowOther: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
} {
  return {
    options: isChoiceType(shape.responseType) ? shape.options : [],
    multiline: isTextType(shape.responseType) ? shape.multiline : false,
    validation: isTextType(shape.responseType) ? shape.validation : "none",
    allowOther: isChoiceType(shape.responseType) ? shape.allowOther : false,
    min: shape.responseType === "number" ? shape.min : null,
    max: shape.responseType === "number" ? shape.max : null,
    step: shape.responseType === "number" ? shape.step : null,
  };
}

// The read side of a stored answer, for showing it to a person — the
// mirror of fieldValueFromFormData, which turns a submission into what
// gets stored.
//
// This exists because the obvious `String(value)` was only ever correct
// while every non-choice answer was prose. Once a yes/no and a figure are
// real stored values, it prints "false" and "2027-03-01" at a member
// deciding how to vote, and a date's canonical form is a storage detail
// rather than something to show a reader. Blank comes back as "" for the
// caller to word as "not answered" — deciding that needs to know whether
// the absence is a skipped question or a genuinely empty answer.
export function formatFieldValue(value: unknown, responseType: string): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(v, responseType)).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return String(value);

  // A canonical date, and only then: a free-text answer that happens to
  // start with a date is prose, and formatting it as one would mangle it.
  // Anything unparseable is shown as typed rather than as "Invalid Date".
  if (responseType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return formatExactDate(value);
  }
  return value;
}

// A submitted field read back out of a FormData, given the shape it was
// rendered from. The same logic the Form path uses
// (forms.ts's formValuesFromFormData) reduced to one field, so a
// ProfileQuestion answer and a Form response are read identically —
// including the escape hatch's sibling text input, and a multi_choice's
// several values under one name.
export function fieldValueFromFormData(shape: FieldShape, formData: FormData, name: string): unknown {
  if (isChoiceType(shape.responseType)) {
    const ticked = formData.getAll(name).map(String);
    const chosen = ticked.filter((v) => shape.options.includes(v));
    const otherText = String(formData.get(otherInputName(name)) ?? "").trim();
    const freeText = otherText && shape.allowOther ? [otherText] : [];
    return shape.responseType === "multi_choice"
      ? [...chosen, ...freeText]
      : (chosen[0] ?? freeText[0] ?? "");
  }
  return String(formData.get(name) ?? "");
}

// The three tags a *Form* field carries on top of a plain shape: which
// field holds the submitter's name, which their email, and which
// once-ever ProfileQuestion this field's answer should seed. Split out
// because they belong to Form.fields and not to the shape itself — a
// ProfileQuestion has no notion of "the name field".
export type FormRoleTags = {
  isNameField?: boolean;
  isEmailField?: boolean;
  mapsToProfileQuestionId?: string;
};

// What the settings field builders edit: a complete shape, plus whether
// it's required, plus whatever role tags the surrounding form needs.
// Lives here rather than in either builder because both are "use client"
// modules, and a Server Component that needs to build one of these
// before rendering a builder cannot call an exported function from a
// client module.
export type EditableFieldShape = FieldShape & { label: string; required: boolean } & FormRoleTags;

// The starting point for a brand-new field in a builder.
export function emptyFieldShape(label = ""): EditableFieldShape {
  return { label, ...DEFAULT_FIELD_SHAPE, required: false };
}

// A stored field read back into an editable one. A Form.fields entry
// written before a flag existed, or by a hand-written row, still opens
// with a sensible editor rather than undefined.
export function toEditableFieldShape(input: {
  label: string;
  responseType: ResponseType;
  options?: string[] | null;
  required?: boolean;
  multiline?: boolean | null;
  validation?: TextValidation | null;
  allowOther?: boolean | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  isNameField?: boolean;
  isEmailField?: boolean;
  mapsToProfileQuestionId?: string;
}): EditableFieldShape {
  return {
    label: input.label,
    required: input.required ?? false,
    ...toFieldShape(input),
    isNameField: input.isNameField,
    isEmailField: input.isEmailField,
    mapsToProfileQuestionId: input.mapsToProfileQuestionId,
  };
}

// A choice field's options with the escape hatch appended when it's on,
// so a renderer and a validator agree on the full set. The hatch is a
// rendering concern only — the text it collects is stored as an ordinary
// string (see validateFieldValue's single_choice/multi_choice cases), so
// nothing downstream needs to know this function exists.
export function optionsWithOther(shape: FieldShape): { value: string; label: string; isOther: boolean }[] {
  const base = shape.options.map((o) => ({ value: o, label: o, isOther: false }));
  return shape.allowOther ? [...base, { value: "Other", label: "Other", isOther: true }] : base;
}
