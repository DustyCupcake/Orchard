import { z } from "zod";

// Carries the review step's already-parsed, already-checked rows
// forward to the confirm step — round-tripped through the URL as a
// single opaque query param rather than a real staging table, the same
// "nothing commits until the whole flow confirms, and this is exactly
// the kind of one-time, ephemeral state this codebase doesn't keep a
// table around for elsewhere either" reasoning Task Pack import's own
// state.ts already established (src/app/(app)/task-packs/import/[packId]/state.ts).
// Base64url-encoded JSON rather than a delimited string, since a name
// or email could itself contain a delimiter character.
const parsedRowShape = z.object({ name: z.string(), email: z.string() });

export const stagedBulkMemberState = z.object({
  newRows: z.array(parsedRowShape),
  alreadyExistsRows: z.array(parsedRowShape),
  malformedLines: z.array(z.string()),
});
export type StagedBulkMemberState = z.infer<typeof stagedBulkMemberState>;

export function encodeBulkMemberState(state: StagedBulkMemberState): string {
  return Buffer.from(JSON.stringify(state), "utf-8").toString("base64url");
}

export function decodeBulkMemberState(raw: string): StagedBulkMemberState | null {
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    return stagedBulkMemberState.parse(json);
  } catch {
    return null;
  }
}
