import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { member, settingsChange, type settingsChangeEntityEnum } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;
type SettingsChangeEntity = (typeof settingsChangeEntityEnum.enumValues)[number];

/**
 * A comparable rendering of a value, for deciding whether it changed.
 *
 * jsonb does not preserve key order — Postgres normalises it by length then
 * bytewise — so `recruitmentDecisionRules` read back off the row is not
 * key-ordered the way the same rules arrive from `JSON.parse` of a form. A
 * plain `JSON.stringify(a) !== JSON.stringify(b)` would therefore report a
 * change on every save of a rule set nobody touched, and since each settings
 * tab resubmits all of its own fields on every save, that is not a rare
 * false positive but the common case. Sorting object keys first makes the
 * comparison blind to the difference that carries no meaning.
 *
 * Array order is left alone, and has to be: modulesEnabled is a set of module
 * keys whose order is not meaningful, but decision rules are explicitly
 * "evaluated top-to-bottom, first match wins" (community.ts's own comment on
 * the column), so reordering those is a real edit and must stay visible.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Write one settings_change row per field that actually differs, and nothing
 * at all when nothing does.
 *
 * The "actually differs" part is the whole reason this takes `current` and
 * `changes` separately rather than diffing two rows. Every settings tab's form
 * submits every field that tab owns on every save — see the four
 * updateXSettingsAction functions in src/app/(app)/settings/actions.ts — so a
 * log built from the submission rather than the difference would bury the one
 * real edit under every field that was merely re-sent. An absent key is
 * "this tab doesn't own it" and is never a candidate; a key present with the
 * value already stored is a candidate that loses.
 *
 * Takes a Tx rather than reaching for `db` itself: the caller is already
 * inside the transaction that performs the edit, and the point of an audit
 * trail is that a gap in it is not possible. Writing the log outside that
 * transaction would let a crash between the two leave a change with no
 * record — the one failure mode that makes an audit log worse than none,
 * because it looks complete.
 */
export async function recordSettingChanges(
  tx: Tx,
  opts: {
    actor: Member;
    entity: SettingsChangeEntity;
    action: string;
    entityId?: string | null;
    entityLabel?: string | null;
    current: Record<string, unknown>;
    changes: Record<string, unknown>;
    /** Field names whose values must not be written, though the change is. */
    withheld?: readonly string[];
  },
): Promise<void> {
  const { actor, entity, action, entityId, entityLabel, current, changes, withheld } = opts;

  const rows = Object.entries(changes)
    // An absent key is a field this action doesn't submit. `undefined` is
    // treated the same way on purpose: the codebase's own idiom for "not
    // supplied" is a spread-guard that can leave the key present but
    // undefined, and reading that as a change to undefined would log a
    // spurious clearing of every untouched field.
    .filter(([, value]) => value !== undefined)
    .filter(([field, value]) => canonical(current[field]) !== canonical(value))
    .map(([field, value]) => {
      const isWithheld = withheld?.includes(field) ?? false;
      return {
        communityId: actor.communityId,
        actorId: actor.id,
        entity,
        entityId: entityId ?? null,
        entityLabel: entityLabel ?? null,
        action,
        field,
        valuesWithheld: isWithheld,
        // Spread rather than assign, because omitted and null are different
        // things in the column and only the flag tells them apart on read —
        // see settings_change's own comment on old_value. A withheld field
        // has to arrive as SQL NULL (key absent); assigning null here would
        // store a JSON null and claim the value was cleared.
        ...(isWithheld ? {} : { oldValue: current[field] ?? null, newValue: value }),
      };
    });

  if (rows.length === 0) {
    return;
  }

  await tx.insert(settingsChange).values(rows);
}

// ────────────────────────────── the read side ──────────────────────────────

export type SettingsChangeRow = {
  id: string;
  entity: SettingsChangeEntity;
  entityId: string | null;
  entityLabel: string | null;
  action: string;
  field: string;
  valuesWithheld: boolean;
  oldValue: unknown;
  newValue: unknown;
  changedAt: Date;
  actorId: string;
  actorName: string;
};

/**
 * The settings change log for one community, newest first.
 *
 * Member-readable, and that is the same reasoning as the settings screen
 * itself being member-readable (see the comment on settings_change_entity):
 * a community cannot deliberate collectively about a threshold it is not
 * allowed to read, and the log is the only place the actual edit is
 * recorded — the Assembly's tally is "always advisory, never auto-applied".
 *
 * One query plus one for names, rather than a join per row. Not a
 * micro-optimisation: a member who renames themselves should not leave their
 * old name written into history, so actorName is resolved here and never
 * stored — see actorId's own comment.
 */
export async function listSettingsChanges(
  actor: Member,
  options: { limit?: number; entity?: SettingsChangeEntity } = {},
): Promise<SettingsChangeRow[]> {
  const rows = await db
    .select({
      id: settingsChange.id,
      entity: settingsChange.entity,
      entityId: settingsChange.entityId,
      entityLabel: settingsChange.entityLabel,
      action: settingsChange.action,
      field: settingsChange.field,
      valuesWithheld: settingsChange.valuesWithheld,
      oldValue: settingsChange.oldValue,
      newValue: settingsChange.newValue,
      changedAt: settingsChange.changedAt,
      actorId: settingsChange.actorId,
    })
    .from(settingsChange)
    .where(
      options.entity
        ? and(
            eq(settingsChange.communityId, actor.communityId),
            eq(settingsChange.entity, options.entity),
          )
        : eq(settingsChange.communityId, actor.communityId),
    )
    // Ordering is by changedAt and *then* actorId before id, and the middle
    // term is not decoration. Rows of one save share a timestamp exactly —
    // they are one INSERT, and defaultNow() is transaction_timestamp() — so
    // the tiebreak decides whether that save's rows come back together. id is
    // a random uuid, so ordering on it alone would scatter a six-field save
    // across six positions, and any consumer that groups consecutive rows
    // into one event (the History tab does) would fragment it. actorId
    // before id is a cheap second grouping key: two saves in the same
    // microsecond by the same member are one event for a reader anyway.
    .orderBy(desc(settingsChange.changedAt), desc(settingsChange.actorId), desc(settingsChange.id))
    // The community row is one row per deployment and entityId is null for
    // both it and open_permission_grant, so there is nothing to page past.
    .limit(options.limit ?? 200);

  if (rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(inArray(member.id, actorIds));
  const nameById = new Map(actors.map((m) => [m.id, m.name]));

  // The `.get()!` is safe rather than optimistic: settings_change.actor_id
  // has a foreign key to member with no onDelete clause, and there is no
  // member-deletion path anywhere in the app — so an actor row cannot go
  // missing while the log survives. 47 other *By columns in this schema
  // constrain themselves the same way, and an audit log whose actor can
  // silently vanish is a worse property to have than one that simply
  // cannot be constructed.
  return rows.map((r) => ({ ...r, actorName: nameById.get(r.actorId)! }));
}

/**
 * How many changes of each kind, for the filter row. Counted independently
 * of the list rather than derived from it, so a filter shows the real total
 * and not "however many of these 200 happened to be on screen".
 */
export async function countSettingsChangesByEntity(
  actor: Member,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ entity: settingsChange.entity, n: sql<number>`count(*)::int` })
    .from(settingsChange)
    .where(eq(settingsChange.communityId, actor.communityId))
    .groupBy(settingsChange.entity);
  return Object.fromEntries(rows.map((r) => [r.entity, r.n]));
}

/**
 * Column name → English.
 *
 * A log entry reading `cycleInitiationTierId` has not explained a change to
 * anybody. This lives in the lib rather than the schema because it is a
 * presentation concern, and it falls through to the raw name rather than
 * throwing, so a newly added column is legible-but-ugly instead of fatal.
 */
const FIELD_LABEL: Record<string, string> = {
  name: "name",
  membershipModel: "membership model",
  branchMembershipModel: "branch membership model",
  cyclesEnabled: "whether the community runs events",
  phasesEnabled: "whether events have phases",
  cycleInitiationTierId: "the tier needed to start an event",
  defaultDateDisplayMode: "how dates read by default",
  onsiteModeEnabled: "on-site mode",
  conflictAckWindowHours: "conflict acknowledgement window",
  taskNominationResponseDays: "task nomination response window",
  callSummaryReadWindowDays: "call summary read window",
  defaultCallHasAgenda: "calls need an agenda",
  defaultCallNeedsSummary: "calls need a summary",
  defaultCallRequireRead: "summaries need reading",
  engagementSoftFlagThreshold: "when a single response is worth noticing",
  engagementPatternThreshold: "when a response counts as a pattern",
  cycleIndicatorsEnabled: "breaking indicators out per event",
  cycleIndicatorsMinMembers: "the smallest population an indicator is broken out for",
  accentPrimary: "primary accent colour",
  accentSecondary: "secondary accent colour",
  logoUrl: "logo",
  oidcIssuerUrl: "single sign-on issuer",
  oidcClientId: "single sign-on client id",
  oidcRequiredRole: "role single sign-on requires",
  oidcPrimary: "single sign-on as the main way in",
  modulesEnabled: "which modules are switched on",
  postCycleFeedbackFormId: "the post-event feedback form",
  recruitmentApplicationFormId: "the application form",
  recruitmentApplicationsOpen: "whether applications are open",
  recruitmentInvitesOpen: "whether invites are open",
  recruitmentInterviewsOpen: "whether interviews are open",
  recruitmentEvaluatorCount: "evaluators needed before a decision",
  recruitmentDecisionRules: "how recommendations become an outcome",
  recruitmentSubscriptionLapseThreshold: "when a subscription lapses",
  recruitmentWiderDiscussionHours: "the community-check window",
  recruitmentObjectionOverrule: "how a concern can be overruled",
  recruitmentObjectionQuorum: "how many people it takes to overrule",
  recruitmentRejectionTemplate: "the starting point for a decline",
  recruitmentNominationWindowHours: "the nomination window",
  loginEmail: "login email",
  sensitive: "whether it is restricted",
  emergencyAccess: "emergency access",
  publishedAsIndicator: "published as a community figure",
  required: "whether it is required",
  archivedAt: "archived",
  tierOrder: "tier order",
  defaultWindowHours: "default window",
  questionKey: "question key",
  key: "key",
  label: "label",
  purpose: "purpose",
  scope: "scope",
  moduleKey: "module",
  cycleTypeId: "event type",
  tierId: "tier",
  minutesRequired: "minutes before it counts",
  allowed: "allowed",
  amount: "amount",
  memberIdentity: "member identity",
  memberName: "name",
  isActive: "active",
};

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/**
 * One row as a sentence.
 *
 * `name: "Fruit" → "Fruit 2"` is a faithful record and useless to a reader;
 * this is the same data as the thing someone would say about it. The old and
 * new values still go into the row — the sentence is for the collapsed
 * summary, not a replacement for the record.
 */
export function describeChange(
  row: Pick<SettingsChangeRow, "action" | "field" | "valuesWithheld" | "oldValue" | "newValue">,
): string {
  const subject = fieldLabel(row.field);

  if (row.valuesWithheld) {
    return `${subject} changed — values not recorded`;
  }

  const show = (v: unknown): string => {
    if (v === null || v === undefined) return "nothing";
    if (Array.isArray(v)) return v.length === 0 ? "nothing" : v.map(show).join(", ");
    if (typeof v === "boolean") return v ? "on" : "off";
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  };

  if (row.action === "created") return `${subject} set to ${show(row.newValue)}`;
  if (row.action === "deleted") return `${subject} removed`;
  if (show(row.oldValue) === show(row.newValue)) return `${subject} saved`;
  return `${subject} from ${show(row.oldValue)} to ${show(row.newValue)}`;
}
