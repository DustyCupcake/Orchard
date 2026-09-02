"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  acknowledgeConflictReport,
  escalateConflictReport,
  fileConflictReport,
  fileConflictReportInput,
  recusePeer,
  recuseSelf,
  resolveConflictReport,
  resolveConflictReportInput,
} from "@/lib/conflict";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/conflict-reports?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/conflict-reports?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function fileConflictReportAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const input = fileConflictReportInput.parse({
      description: String(formData.get("description") ?? "") || undefined,
      excludeMemberIds: formData.getAll("excludeMemberIds").map(String),
    });
    await fileConflictReport(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}

export async function acknowledgeConflictReportAction(formData: FormData) {
  const actor = await requireMember();
  const reportId = String(formData.get("reportId"));

  try {
    await acknowledgeConflictReport(actor, reportId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}

export async function resolveConflictReportAction(formData: FormData) {
  const actor = await requireMember();
  const reportId = String(formData.get("reportId"));

  try {
    const input = resolveConflictReportInput.parse({
      resolutionNote: String(formData.get("resolutionNote") ?? ""),
    });
    await resolveConflictReport(actor, reportId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}

export async function escalateConflictReportAction(formData: FormData) {
  const actor = await requireMember();
  const reportId = String(formData.get("reportId"));

  try {
    await escalateConflictReport(actor, reportId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}

export async function recuseSelfAction(formData: FormData) {
  const actor = await requireMember();
  const reportId = String(formData.get("reportId"));

  try {
    await recuseSelf(actor, reportId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}

export async function recusePeerAction(formData: FormData) {
  const actor = await requireMember();
  const reportId = String(formData.get("reportId"));
  const memberId = String(formData.get("memberId"));

  try {
    await recusePeer(actor, reportId, memberId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/conflict-reports");
}
