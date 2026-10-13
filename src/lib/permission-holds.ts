import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { member, permissionHolding, sensitiveFieldAccessRule } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import type { PermissionModuleKey } from "./permissions";

type Member = typeof memberTable.$inferSelect;

// Reads over permission_holding, which records authority as *acquired* to
// pair with permission_grant's authority as *configured*. Audit only — the
// table's own comment is the reason nothing here may answer a capability
// question, and these functions are deliberately shaped like
// settings/history.ts's reads: they take the actor for community scoping and
// leave the authorisation decision to the caller, because who may see this
// is a product question (this is who *held* Admin or Support, which is a
// sharper thing than who *granted* it) rather than something a library
// should settle.

export type PermissionHold = {
  id: string;
  memberId: string;
  memberName: string;
  taskId: string;
  taskTitle: string;
  moduleKeys: PermissionModuleKey[];
  claimedAt: Date;
  /** Null means still held, as of this read. */
  releasedAt: Date | null;
  durationMs: number | null;
};

/**
 * Which of a Community's permission modules can read restricted answers.
 *
 * Derived from the Community's own `sensitive_field_access_rule` rows rather
 * than from a hardcoded list of "sensitive" modules, for the same reason
 * satisfiedRuleIds takes rules as data: a community that has attached a
 * question to `kitchen` has made Kitchen a data-reading role, and one that
 * has not has not. A hardcoded list would have to be kept in step with
 * configuration the code never sees, and would be wrong the moment somebody
 * attached a restricted question to a module nobody anticipated.
 *
 * Read-only and independent of whether the module is currently open: D9
 * settled that an open module does not unlock a restricted question, so
 * openness is not a route to the data and is deliberately not consulted.
 */
export async function listDataUnlockingModules(communityId: string): Promise<Set<PermissionModuleKey>> {
  const rows = await db
    .selectDistinct({ moduleKey: sensitiveFieldAccessRule.unlockedByGrantModuleKey })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.communityId, communityId));
  return new Set(rows.map((r) => r.moduleKey).filter((k): k is PermissionModuleKey => Boolean(k)));
}

/**
 * The holding log for one Community, newest claim first.
 *
 * The investigative read: "who was able to read restricted answers on date
 * X" is answered by this and the rules above it, which is why the module
 * snapshot is stored rather than joined. Names are resolved in one batched
 * query for the same reason settings/history.ts does it — a member who
 * renames themselves should not leave a stale name written into a report.
 */
export async function listPermissionHolds(
  actor: Member,
  options: { since?: Date; limit?: number } = {},
): Promise<PermissionHold[]> {
  const rows = await db
    .select()
    .from(permissionHolding)
    .where(
      options.since
        ? and(
            eq(permissionHolding.communityId, actor.communityId),
            gte(permissionHolding.claimedAt, options.since),
          )
        : eq(permissionHolding.communityId, actor.communityId),
    )
    .orderBy(desc(permissionHolding.claimedAt))
    .limit(options.limit ?? 200);

  if (rows.length === 0) return [];
  const nameById = await namesFor(rows.map((r) => r.memberId));

  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    memberName: nameById.get(r.memberId) ?? "—",
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    moduleKeys: r.moduleKeys,
    claimedAt: r.claimedAt,
    releasedAt: r.releasedAt,
    // Null rather than Infinity for a still-open hold: "how long" is
    // genuinely unknown for a holding that has not ended, and a fabricated
    // number would sort as the longest hold in any report built on it.
    durationMs: r.releasedAt ? r.releasedAt.getTime() - r.claimedAt.getTime() : null,
  }));
}

export type ShortHoldFlag = {
  memberId: string;
  memberName: string;
  /** The union across this member's flagged episodes. */
  moduleKeys: PermissionModuleKey[];
  /** Whether any flagged module unlocks restricted answers here. */
  unlocksRestrictedData: boolean;
  episodes: {
    taskId: string;
    taskTitle: string;
    moduleKeys: PermissionModuleKey[];
    claimedAt: Date;
    releasedAt: Date;
    durationMs: number;
  }[];
};

/**
 * Members who repeatedly claimed a permission and dropped it quickly.
 *
 * **A single short hold is not a finding, and the default threshold says so.**
 * Coordinators claim and release tasks constantly and legitimately — a
 * five-minute hold on Kitchen is somebody checking a menu. What is worth a
 * second look is the same person doing it again and again, especially on a
 * module that can read restricted answers, because that is what acquiring
 * authority for a purpose you have not declared looks like from outside.
 *
 * Hence three thresholds rather than one: `since` bounds the window (so the
 * query stays cheap and "recent" is the actual claim), `shorterThanMs`
 * defines a short hold, and `minEpisodes` is what separates repetition from
 * an ordinary day. The defaults are deliberately conservative — the output is
 * a list for a human to read, and a detector that cries wolf on a community
 * doing its job gets ignored, which is worse than not shipping.
 *
 * Returns findings, never notifications. Where one goes, and who reads it, is
 * a separate decision: the Dashboard feed is this app's only needs-action
 * surface and the settings History tab is member-readable by design, but
 * neither is obviously right for "Sam briefly held Support six times", and
 * guessing here would bake a routing decision into a query.
 */
export async function listShortPermissionHolds(
  actor: Member,
  options: { since?: Date; shorterThanMs?: number; minEpisodes?: number } = {},
): Promise<ShortHoldFlag[]> {
  const since =
    options.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const shorterThanMs = options.shorterThanMs ?? 60 * 60 * 1000;
  const minEpisodes = options.minEpisodes ?? 3;

  const rows = await db
    .select()
    .from(permissionHolding)
    .where(
      and(
        eq(permissionHolding.communityId, actor.communityId),
        gte(permissionHolding.claimedAt, since),
        // Open holds are excluded outright rather than treated as infinitely
        // long: they are the normal case for anyone currently doing the job,
        // and including them would make every current holder a flag.
        isNotNull(permissionHolding.releasedAt),
      ),
    )
    .orderBy(desc(permissionHolding.claimedAt));

  const short = rows.filter((r) => r.releasedAt!.getTime() - r.claimedAt.getTime() < shorterThanMs);
  if (short.length === 0) return [];

  const byMember = new Map<string, typeof short>();
  for (const row of short) {
    const list = byMember.get(row.memberId) ?? [];
    list.push(row);
    byMember.set(row.memberId, list);
  }

  const flagged = [...byMember.entries()].filter(([, list]) => list.length >= minEpisodes);
  if (flagged.length === 0) return [];

  const [dataModules, nameById] = await Promise.all([
    listDataUnlockingModules(actor.communityId),
    namesFor(flagged.map(([memberId]) => memberId)),
  ]);

  return flagged.map(([memberId, list]) => {
    const moduleKeys = [...new Set(list.flatMap((r) => r.moduleKeys))];
    return {
      memberId,
      memberName: nameById.get(memberId) ?? "—",
      moduleKeys,
      unlocksRestrictedData: moduleKeys.some((k) => dataModules.has(k)),
      episodes: list.map((r) => ({
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        moduleKeys: r.moduleKeys,
        claimedAt: r.claimedAt,
        releasedAt: r.releasedAt!,
        durationMs: r.releasedAt!.getTime() - r.claimedAt.getTime(),
      })),
    };
  });
}

async function namesFor(memberIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(inArray(member.id, ids));
  return new Map(rows.map((m) => [m.id, m.name]));
}