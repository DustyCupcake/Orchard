import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireAdmins } from "./admins";

type Member = typeof memberTable.$inferSelect;

export type ParsedMemberRow = { name: string; email: string };

// Tolerant of whatever a person exporting a real contact list is
// likely to actually paste (or save as .csv and upload — both sources
// land here, since a CSV's raw text is the identical "one row per
// line" shape) — one "Name,Email" pair per line, stray whitespace and
// quoting stripped, blank lines skipped. Not a real CSV parser (no
// escaped-comma support) — this app's other free-text intake (task
// tags, requirement flags) takes the same plain-split posture rather
// than reaching for a library.
export function parseBulkMemberRows(raw: string): {
  rows: ParsedMemberRow[];
  malformedLines: string[];
} {
  const rows: ParsedMemberRow[] = [];
  const malformedLines: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [namePart, emailPart] = trimmed.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (!namePart || !emailPart || !emailPart.includes("@")) {
      malformedLines.push(trimmed);
      continue;
    }
    rows.push({ name: namePart, email: emailPart.toLowerCase() });
  }

  return { rows, malformedLines };
}

// Global by (provider, loginEmail), not scoped to the actor's own
// community — matches member_identity's own unique index and
// findOrCreateMemberByEmail's identical lookup shape (src/lib/member.ts):
// this app is single-tenant per deployment in practice, and an email
// already claimed by a magic_link identity anywhere is already claimed,
// full stop.
async function findAlreadyClaimedEmails(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const existing = await db
    .select({ loginEmail: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.provider, "magic_link"), inArray(memberIdentity.loginEmail, emails)));
  return new Set(existing.map((e) => e.loginEmail));
}

export async function previewBulkMemberImport(actor: Member, rows: ParsedMemberRow[]) {
  await requireAdmins(actor);
  const claimed = await findAlreadyClaimedEmails(rows.map((r) => r.email));
  return {
    newRows: rows.filter((r) => !claimed.has(r.email)),
    alreadyExistsRows: rows.filter((r) => claimed.has(r.email)),
  };
}

// Re-checks for an already-claimed email again at commit time rather
// than trusting the review step's own snapshot — the same defense-in-
// depth posture this codebase's other two-step review/confirm flows
// (Pack import, Phase 55) already take; someone else could plausibly
// have joined with one of these emails in the gap between review and
// confirm. Each row lands exactly where a magic-link first login
// would (a real Member + a magic_link MemberIdentity, no password) —
// skipping Recruitment's application/evaluation funnel entirely, since
// an Admin calling this is directly vouching for people already known
// to be real members of their own group.
export async function commitBulkMemberImport(
  actor: Member,
  rows: ParsedMemberRow[],
): Promise<{ created: number }> {
  await requireAdmins(actor);
  const claimed = await findAlreadyClaimedEmails(rows.map((r) => r.email));
  const toCreate = rows.filter((r) => !claimed.has(r.email));

  for (const row of toCreate) {
    await db.transaction(async (tx) => {
      const [newMember] = await tx
        .insert(member)
        .values({ communityId: actor.communityId, name: row.name })
        .returning();
      await tx.insert(memberIdentity).values({
        memberId: newMember.id,
        provider: "magic_link",
        loginEmail: row.email,
      });
    });
  }

  return { created: toCreate.length };
}
