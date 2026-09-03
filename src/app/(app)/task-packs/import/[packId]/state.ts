import { z } from "zod";

// Carries Screen One's already-decided branch resolutions forward to
// Screen Two (the per-task reassignment view, only reached when
// something was declined — see docs/spec.md's "Pack import review").
// Round-tripped through the URL as a single opaque query param rather
// than a real staging table: nothing commits until the whole flow
// confirms, and this is exactly the kind of one-time, ephemeral state
// this codebase doesn't keep a table around for elsewhere either
// (compare src/lib/view-as.ts's own choice to overlay the session row
// instead of inventing new storage). Base64url-encoded JSON rather than
// a delimited string, since a hint is a free-text branch name that
// could itself contain any delimiter character.
const hintResolutionShape = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_existing"), branchId: z.string().uuid() }),
  z.object({ action: z.literal("create_new") }),
]);

export const stagedImportState = z.object({
  cycleName: z.string(),
  cycleTypeId: z.string().uuid().nullable(),
  resolvedHints: z.record(z.string(), hintResolutionShape),
  declinedHints: z.array(z.string()),
});
export type StagedImportState = z.infer<typeof stagedImportState>;

export function encodeImportState(state: StagedImportState): string {
  return Buffer.from(JSON.stringify(state), "utf-8").toString("base64url");
}

export function decodeImportState(raw: string): StagedImportState | null {
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    return stagedImportState.parse(json);
  } catch {
    return null;
  }
}
