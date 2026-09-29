import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireAdmins } from "./admins";
import { recordSettingChanges } from "./history";
import { seedPrimaryContactMethod } from "../contact-methods";

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
      // Unverified, and deliberately so even though the Admin vouching for
      // the roster knows these people. `verifiedAt` is a fact about the
      // inbox, and an Admin's knowledge of it is not proof of it — marking
      // it here would make the flag mean "somebody in the loop believed
      // this", which is a different and much weaker thing than the one the
      // primary gate relies on. Delivery falls back to the login address
      // meanwhile, which is this same address.
      await seedPrimaryContactMethod(tx, newMember.id, row.email, { verified: false });

      // One transaction per row rather than one for the whole import, which
      // is what it was before and is not changed here. The log is written
      // inside each row's transaction, so it inherits that granularity: a
      // run of 200 rows writes 200 log rows, one per person, and a partial
      // failure leaves the log describing exactly the people who did land.
      // A single log row for the whole import would instead be either lost
      // wholesale or a summary nobody can reconcile against the roster.
      //
      // The email is the one field withheld anywhere in this log, and
      // withholding it here is the whole reason: member-readable settings
      // history plus a log of every imported address would hand the whole
      // community the login addresses of every member an Admin ever
      // imported. So the row records the name and the fact that an
      // identity was created, and `valuesWithheld` says the address is not
      // there rather than leaving a reader to guess whether it was ever
      // null or merely hidden.
      await recordSettingChanges(tx, {
        actor,
        entity: "bulk_member_import",
        action: "created",
        entityId: newMember.id,
        entityLabel: newMember.name,
        current: {},
        changes: { memberName: newMember.name, memberIdentity: { provider: "magic_link", loginEmail: row.email } },
        withheld: ["memberIdentity"],
      });
    });
  }

  return { created: toCreate.length };
}
