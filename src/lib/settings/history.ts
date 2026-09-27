import type { Tx } from "@/db";
import { settingsChange, type settingsChangeEntityEnum } from "@/db/schema";
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
