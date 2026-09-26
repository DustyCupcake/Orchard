"use server";

import { ZodError, z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  addAgendaItem,
  addAgendaItemInput,
  removeAgendaItem,
  submitAssemblyResponses,
} from "@/lib/assemblies";
import { AppError } from "@/lib/errors";

function redirectWithError(assemblyId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/assemblies/${assemblyId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/assemblies/${assemblyId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export type AgendaItemFormState = { error?: string; ok?: boolean };

/**
 * Adding an agenda item.
 *
 * Deliberately *returns* its failure rather than redirecting with
 * `?error=`. The old redirect re-rendered the form empty, so a rejected
 * submit — the "options are required" case, above all — threw away
 * everything the member had typed, including a partly-written option
 * list. Returning lets AgendaItemForm show the message inline with the
 * draft intact. The success path is still a revalidate, so the new item
 * appears without a full page load.
 */
export async function addAgendaItemAction(
  _prev: AgendaItemFormState,
  formData: FormData,
): Promise<AgendaItemFormState> {
  const actor = await requireMember();
  const assemblyId = String(formData.get("assemblyId"));

  // Each option is its own `option` field now, so the comma-splitting
  // this replaces is gone entirely — an option containing a comma is
  // just an option containing a comma.
  const options = formData.getAll("option").map(String);

  // A number item's bounds, or null when the form left them blank.
  function numberOrNull(raw: FormDataEntryValue | null): number | null {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  try {
    const input = addAgendaItemInput.parse({
      text: String(formData.get("text") ?? ""),
      responseType: String(formData.get("responseType") ?? "text"),
      options: options.length > 0 ? options : undefined,
      // The field-shape flags AgendaItemForm's hidden inputs carry.
      // Blank means off/null, matching how the settings builders
      // serialize the same flags.
      multiline: formData.get("multiline") === "on",
      allowOther: formData.get("allowOther") === "on",
      min: numberOrNull(formData.get("min")),
      max: numberOrNull(formData.get("max")),
    });
    await addAgendaItem(actor, assemblyId, input);
  } catch (err) {
    if (err instanceof ZodError) {
      return { error: err.issues[0]?.message ?? "Invalid input" };
    }
    if (err instanceof AppError) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/assemblies/${assemblyId}`);
  return { ok: true };
}

export async function removeAgendaItemAction(formData: FormData) {
  const actor = await requireMember();
  const assemblyId = String(formData.get("assemblyId"));
  const questionId = String(formData.get("questionId"));

  try {
    await removeAgendaItem(actor, questionId);
  } catch (err) {
    redirectWithError(assemblyId, err);
  }

  revalidatePath(`/assemblies/${assemblyId}`);
}

/**
 * Answering the whole agenda in one submit.
 *
 * The payload is a JSON blob of `{ questionId: value }` rather than a
 * pile of same-named form fields. That is what lets one form hold every
 * question's controls at once without them colliding: the old per-item
 * form relied on `value` vs `value_multi` and a `multi.length > 0 ?
 * multi : single` fallback to work out which kind of question it was
 * looking at, which is exactly the kind of inference that breaks the
 * moment an unselected pick-any question is in the batch.
 */
export async function submitAssemblyResponsesAction(
  _prev: AgendaItemFormState,
  formData: FormData,
) {
  const actor = await requireMember();
  const assemblyId = String(formData.get("assemblyId"));

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("answers") ?? "{}"));
  } catch {
    return { error: "Couldn't read your answers — please try again" };
  }

  // `unknown` rather than the old string | string[]: the six shared field
  // shapes mean an answer can now be a real boolean or number, and this
  // is JSON.parse output that the per-item validator is about to check
  // against that item's own shape. Narrowing here would only re-state a
  // guess the validator makes properly — and would reject exactly the
  // answers the agenda composer can now elicit.
  const parsed = z
    .object({
      questionId: z.string().uuid(),
      value: z.unknown(),
    })
    .array()
    .safeParse(payload);
  if (!parsed.success) {
    return { error: "Couldn't read your answers — please try again" };
  }

  const answers: Record<string, unknown> = {};
  for (const entry of parsed.data) {
    answers[entry.questionId] = entry.value;
  }

  const result = await submitAssemblyResponses(
    actor,
    parsed.data.map((e) => e.questionId),
    answers,
  );

  revalidatePath(`/assemblies/${assemblyId}`);

  if (result.failed.length > 0) {
    return {
      error:
        result.failed.length === 1
          ? `One answer didn't save: ${result.failed[0].message}`
          : `${result.failed.length} answers didn't save — the rest were fine. ${result.failed[0].message}`,
    };
  }
  return { ok: true };
}
